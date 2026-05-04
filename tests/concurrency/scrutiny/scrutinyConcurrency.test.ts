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
  insertStudent,
  sha256,
  type TestIds,
} from '../helpers/postgresTestUtils';
import { finaleElection, submitKey } from '../../../src/modules/scrutiny/services/scrutinyService';
import { pool as appPool } from '../../../src/config/database';

async function insertScrutinyKey(
  pool: Pool,
  electionId: string,
  memberId: string,
  plainKey: string,
  hasSubmitted = false
): Promise<void> {
  await pool.query(
    `INSERT INTO scrutiny_keys (election_id, member_id, key_shard, has_submitted, submitted_at)
     VALUES ($1, $2, $3, $4, CASE WHEN $4 THEN now() ELSE NULL END)`,
    [electionId, memberId, sha256(plainKey), hasSubmitted]
  );
}

describe('scrutiny concurrency', () => {
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
  });

  afterAll(async () => {
    await pool.end();
    await appPool.end();
  });

  it('accepts a scrutiny key only once when the same member submits it 50 times concurrently', async () => {
    const electionId = await insertElection(pool, ids, {
      status: 'CLOSED',
      requires_keys: true,
      min_keys: 2,
      end_time: new Date('2026-05-01T12:00:00.000Z'),
    });
    const memberId = await insertStudent(pool, ids);
    await insertScrutinyKey(pool, electionId, memberId, 'member-key');

    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENT_REQUESTS }, () =>
        submitKey({
          election_id: electionId,
          member_id: memberId,
          key_shard: 'member-key',
        })
      )
    );

    const submitted = await pool.query<{ submitted: string }>(
      `SELECT COUNT(*) FILTER (WHERE has_submitted = true) AS submitted
       FROM scrutiny_keys
       WHERE election_id = $1`,
      [electionId]
    );

    expect(countFulfilled(results)).toBe(1);
    expect(Number(submitted.rows[0].submitted)).toBe(1);
  });

  it('submits different keys concurrently and finalizes the election exactly once', async () => {
    const electionId = await insertElection(pool, ids, {
      status: 'CLOSED',
      requires_keys: true,
      min_keys: 2,
      end_time: new Date('2026-05-01T12:00:00.000Z'),
    });
    const memberOne = await insertStudent(pool, ids, {
      email: 'scrutiny-member-one@estudiantec.cr',
      carnet: 'TCK000001',
    });
    const memberTwo = await insertStudent(pool, ids, {
      email: 'scrutiny-member-two@estudiantec.cr',
      carnet: 'TCK000002',
    });
    await insertScrutinyKey(pool, electionId, memberOne, 'key-one');
    await insertScrutinyKey(pool, electionId, memberTwo, 'key-two');

    const results = await Promise.allSettled([
      submitKey({ election_id: electionId, member_id: memberOne, key_shard: 'key-one' }),
      submitKey({ election_id: electionId, member_id: memberTwo, key_shard: 'key-two' }),
    ]);

    const election = await pool.query<{ status: string }>(
      'SELECT status FROM elections WHERE id = $1',
      [electionId]
    );
    const audit = await pool.query<{ total: string }>(
      `SELECT COUNT(*) AS total
       FROM audit_logs
       WHERE resource_type = 'election'
         AND resource_id = $1
         AND action = 'scrutiny.finalize'`,
      [electionId]
    );

    expect(countFulfilled(results)).toBe(2);
    expect(election.rows[0].status).toBe('SCRUTINIZED');
    expect(Number(audit.rows[0].total)).toBe(1);
  });

  it('treats 50 simultaneous finalization requests as one finalization', async () => {
    const electionId = await insertElection(pool, ids, {
      status: 'CLOSED',
      requires_keys: true,
      min_keys: 1,
      end_time: new Date('2026-05-01T12:00:00.000Z'),
    });
    const memberId = await insertStudent(pool, ids);
    await insertScrutinyKey(pool, electionId, memberId, 'submitted-key', true);

    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENT_REQUESTS }, () => finaleElection(electionId, memberId))
    );

    const election = await pool.query<{ status: string }>(
      'SELECT status FROM elections WHERE id = $1',
      [electionId]
    );
    const audit = await pool.query<{ total: string }>(
      `SELECT COUNT(*) AS total
       FROM audit_logs
       WHERE resource_type = 'election'
         AND resource_id = $1
         AND action = 'scrutiny.finalize'`,
      [electionId]
    );

    expect(countFulfilled(results)).toBe(CONCURRENT_REQUESTS);
    expect(election.rows[0].status).toBe('SCRUTINIZED');
    expect(Number(audit.rows[0].total)).toBe(1);
  });
});
