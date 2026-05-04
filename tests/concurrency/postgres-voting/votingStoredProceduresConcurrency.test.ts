import { afterAll, beforeAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  applyVotingStoredProcedures,
  cleanupTestData,
  CONCURRENT_REQUESTS,
  countFulfilled,
  countRejected,
  createPool,
  createTestIds,
  insertElection,
  insertElectionVoter,
  insertOption,
  insertStudent,
  sha256,
  type TestIds,
} from '../helpers/postgresTestUtils';

describe('postgres voting concurrency', () => {
  let pool: Pool;
  let ids: TestIds;

  beforeAll(async () => {
    pool = createPool();
    await applyVotingStoredProcedures(pool);
  });

  afterEach(async () => {
    await cleanupTestData(pool, ids);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(() => {
    ids = createTestIds();
  });

  it('allows only one direct named vote for the same voter under 50 concurrent calls', async () => {
    const electionId = await insertElection(pool, ids, { is_anonymous: false });
    const optionId = await insertOption(pool, electionId);
    const studentId = await insertStudent(pool, ids);
    await insertElectionVoter(pool, electionId, studentId);

    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENT_REQUESTS }, () =>
        pool.query('SELECT fn_cast_vote_named($1, $2, $3)', [
          electionId,
          optionId,
          studentId,
        ])
      )
    );

    const voteCount = await pool.query<{ total: string }>(
      'SELECT COUNT(*) AS total FROM votes WHERE election_id = $1',
      [electionId]
    );
    const voterState = await pool.query<{ token_used: boolean }>(
      'SELECT token_used FROM election_voters WHERE election_id = $1 AND student_id = $2',
      [electionId, studentId]
    );

    expect(countFulfilled(results)).toBe(1);
    expect(countRejected(results)).toBe(CONCURRENT_REQUESTS - 1);
    expect(Number(voteCount.rows[0].total)).toBe(1);
    expect(voterState.rows[0].token_used).toBe(true);
  });

  it('records all direct named votes for 50 different eligible voters', async () => {
    const electionId = await insertElection(pool, ids, { is_anonymous: false });
    const optionId = await insertOption(pool, electionId);
    const studentIds = await Promise.all(
      Array.from({ length: CONCURRENT_REQUESTS }, (_, index) =>
        insertStudent(pool, ids, {
          carnet: `TCD${String(index).padStart(6, '0')}`,
          email: `concurrent-distinct-${index}@estudiantec.cr`,
        })
      )
    );
    await Promise.all(studentIds.map((studentId) => insertElectionVoter(pool, electionId, studentId)));

    const results = await Promise.allSettled(
      studentIds.map((studentId) =>
        pool.query('SELECT fn_cast_vote_named($1, $2, $3)', [
          electionId,
          optionId,
          studentId,
        ])
      )
    );

    const voteCount = await pool.query<{ total: string; voters: string }>(
      `SELECT COUNT(*) AS total, COUNT(DISTINCT student_id) AS voters
       FROM votes
       WHERE election_id = $1`,
      [electionId]
    );

    expect(countFulfilled(results)).toBe(CONCURRENT_REQUESTS);
    expect(countRejected(results)).toBe(0);
    expect(Number(voteCount.rows[0].total)).toBe(CONCURRENT_REQUESTS);
    expect(Number(voteCount.rows[0].voters)).toBe(CONCURRENT_REQUESTS);
  });

  it('allows only one direct anonymous vote for the same token under 50 concurrent calls', async () => {
    const electionId = await insertElection(pool, ids, { is_anonymous: true });
    const optionId = await insertOption(pool, electionId);
    const studentId = await insertStudent(pool, ids);
    const tokenHash = sha256('anonymous-concurrent-token');
    await insertElectionVoter(pool, electionId, studentId);
    await pool.query(
      `INSERT INTO voting_tokens (election_id, student_id, token_hash, token_encrypted, used)
       VALUES ($1, $2, $3, $4, false)`,
      [electionId, studentId, tokenHash, 'encrypted-token']
    );

    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENT_REQUESTS }, () =>
        pool.query('SELECT fn_cast_vote_anonymous($1, $2, $3)', [
          electionId,
          optionId,
          tokenHash,
        ])
      )
    );

    const voteCount = await pool.query<{ total: string }>(
      'SELECT COUNT(*) AS total FROM votes WHERE election_id = $1',
      [electionId]
    );
    const tokenState = await pool.query<{
      used: boolean;
      token_hash: string | null;
      token_encrypted: string | null;
    }>(
      'SELECT used, token_hash, token_encrypted FROM voting_tokens WHERE election_id = $1 AND student_id = $2',
      [electionId, studentId]
    );

    expect(countFulfilled(results)).toBe(1);
    expect(countRejected(results)).toBe(CONCURRENT_REQUESTS - 1);
    expect(Number(voteCount.rows[0].total)).toBe(1);
    expect(tokenState.rows[0]).toMatchObject({
      used: true,
      token_hash: null,
      token_encrypted: null,
    });
  });
});
