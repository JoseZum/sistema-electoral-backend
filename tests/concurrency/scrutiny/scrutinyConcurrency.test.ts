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

async function cleanupScrutinyAuditLogs(pool: Pool, ids: TestIds): Promise<void> {
  await pool.query(
    `DELETE FROM audit_logs
     WHERE resource_id = ANY($1::text[])
        OR resource_id = ANY($2::text[])
        OR EXISTS (
          SELECT 1
          FROM unnest($1::text[]) AS election_ids(id)
          WHERE audit_logs.resource_id LIKE election_ids.id || ':%'
        )`,
    [ids.electionIds, ids.studentIds]
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
    await cleanupScrutinyAuditLogs(pool, ids);
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

  it('submits 50 different scrutiny keys concurrently without dropping submissions', async () => {
    const electionId = await insertElection(pool, ids, {
      status: 'CLOSED',
      requires_keys: true,
      min_keys: CONCURRENT_REQUESTS + 1,
      end_time: new Date('2026-05-01T12:00:00.000Z'),
    });
    const members: Array<{ memberId: string; key: string }> = [];
    for (let index = 0; index < CONCURRENT_REQUESTS; index += 1) {
      const memberId = await insertStudent(pool, ids);
      const key = `member-key-${index}`;
      await insertScrutinyKey(pool, electionId, memberId, key);
      members.push({ memberId, key });
    }

    const results = await Promise.allSettled(
      members.map((member) =>
        submitKey({
          election_id: electionId,
          member_id: member.memberId,
          key_shard: member.key,
        })
      )
    );

    const state = await pool.query<{ status: string; submitted: string }>(
      `SELECT e.status,
              COUNT(sk.id) FILTER (WHERE sk.has_submitted = true) AS submitted
       FROM elections e
       LEFT JOIN scrutiny_keys sk ON sk.election_id = e.id
       WHERE e.id = $1
       GROUP BY e.id`,
      [electionId]
    );

    expect(countFulfilled(results)).toBe(CONCURRENT_REQUESTS);
    expect(state.rows[0].status).toBe('CLOSED');
    expect(Number(state.rows[0].submitted)).toBe(CONCURRENT_REQUESTS);
  });

  it('submits different keys concurrently and finalizes the election exactly once', async () => {
    const electionId = await insertElection(pool, ids, {
      status: 'CLOSED',
      requires_keys: true,
      min_keys: 2,
      end_time: new Date('2026-05-01T12:00:00.000Z'),
    });
    const memberOne = await insertStudent(pool, ids);
    const memberTwo = await insertStudent(pool, ids);
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
