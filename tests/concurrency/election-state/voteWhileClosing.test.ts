import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  applyVotingStoredProcedures,
  cleanupTestData,
  CONCURRENT_REQUESTS,
  countFulfilled,
  createPool,
  createTestIds,
  insertElection,
  insertElectionVoter,
  insertOption,
  insertStudent,
  type TestIds,
} from '../helpers/postgresTestUtils';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('voting while election is closing', () => {
  let pool: Pool;
  let ids: TestIds;

  beforeAll(async () => {
    pool = createPool();
    await applyVotingStoredProcedures(pool);
  });

  beforeEach(() => {
    ids = createTestIds();
  });

  afterEach(async () => {
    await cleanupTestData(pool, ids);
    await pool.query('DELETE FROM audit_logs WHERE resource_id = ANY($1::text[])', [
      [...ids.electionIds, ...ids.studentIds],
    ]);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('rejects votes that reach the database after a concurrent close commits first', async () => {
    const electionId = await insertElection(pool, ids, { is_anonymous: false, status: 'OPEN' });
    const optionId = await insertOption(pool, electionId);
    const studentIds = await Promise.all(
      Array.from({ length: CONCURRENT_REQUESTS }, () => insertStudent(pool, ids))
    );
    await Promise.all(studentIds.map((studentId) => insertElectionVoter(pool, electionId, studentId)));

    const closer = await pool.connect();
    try {
      await closer.query('BEGIN');
      // The close transaction owns the election row first. Vote attempts must wait
      // in fn_cast_vote_named and reject after CLOSED commits.
      await closer.query(
        `UPDATE elections
         SET status = 'CLOSED'::election_status
         WHERE id = $1`,
        [electionId]
      );

      const voteAttempts = Promise.allSettled(
        studentIds.map((studentId) =>
          pool.query('SELECT fn_cast_vote_named($1, $2, $3)', [
            electionId,
            optionId,
            studentId,
          ])
        )
      );

      await wait(100);
      await closer.query('COMMIT');

      const results = await voteAttempts;
      const voteCount = await pool.query<{ total: string }>(
        'SELECT COUNT(*) AS total FROM votes WHERE election_id = $1',
        [electionId]
      );
      const voterCount = await pool.query<{ voted: string }>(
        `SELECT COUNT(*) FILTER (WHERE token_used = true) AS voted
         FROM election_voters
         WHERE election_id = $1`,
        [electionId]
      );

      expect(countFulfilled(results)).toBe(0);
      expect(Number(voteCount.rows[0].total)).toBe(0);
      expect(Number(voterCount.rows[0].voted)).toBe(0);
      expect(
        results.every(
          (result) =>
            result.status === 'rejected' &&
            result.reason instanceof Error &&
            result.reason.message.includes('La votacion no esta abierta')
        )
      ).toBe(true);
    } finally {
      await closer.query('ROLLBACK').catch(() => undefined);
      closer.release();
    }
  });
});
