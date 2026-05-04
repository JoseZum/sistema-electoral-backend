import { randomUUID } from 'crypto';
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
  let optionIds: string[];
  let testSuffix: string;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required to run postgres voting concurrency tests.');
    }

    pool = createPool();
    await applyVotingStoredProcedures(pool);
  });

  afterEach(async () => {
    await cleanupTestData(pool, ids);
    await pool.query('DELETE FROM audit_logs WHERE resource_id = ANY($1::text[])', [
      [...ids.electionIds, ...ids.studentIds, ...optionIds],
    ]);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(() => {
    ids = createTestIds();
    optionIds = [];
    testSuffix = randomUUID().replace(/-/g, '').slice(0, 12);
  });

  async function insertTrackedOption(electionId: string, label = 'Opcion concurrente') {
    const optionId = await insertOption(pool, electionId, label);
    optionIds.push(optionId);
    return optionId;
  }

  function uniqueCarnet(index: number) {
    return `TC${testSuffix}${String(index).padStart(3, '0')}`;
  }

  function uniqueEmail(index: number) {
    return `concurrent-${testSuffix}-${index}@estudiantec.cr`;
  }

  it('allows only one direct named vote for the same voter under 50 concurrent calls', async () => {
    const electionId = await insertElection(pool, ids, { is_anonymous: false });
    const optionId = await insertTrackedOption(electionId);
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
    const optionId = await insertTrackedOption(electionId);
    const studentIds = await Promise.all(
      Array.from({ length: CONCURRENT_REQUESTS }, (_, index) =>
        insertStudent(pool, ids, {
          carnet: uniqueCarnet(index),
          email: uniqueEmail(index),
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
    const optionId = await insertTrackedOption(electionId);
    const studentId = await insertStudent(pool, ids);
    const tokenHash = sha256(`anonymous-concurrent-token-${testSuffix}`);
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

  it('records all direct anonymous votes for 50 different tokens', async () => {
    const electionId = await insertElection(pool, ids, { is_anonymous: true });
    const optionId = await insertTrackedOption(electionId);
    const studentIds = await Promise.all(
      Array.from({ length: CONCURRENT_REQUESTS }, (_, index) =>
        insertStudent(pool, ids, {
          carnet: uniqueCarnet(index),
          email: uniqueEmail(index),
        })
      )
    );
    await Promise.all(studentIds.map((studentId) => insertElectionVoter(pool, electionId, studentId)));

    const tokenHashes = studentIds.map((studentId, index) =>
      sha256(`anonymous-distinct-token-${testSuffix}-${index}-${studentId}`)
    );
    await Promise.all(
      studentIds.map((studentId, index) =>
        pool.query(
          `INSERT INTO voting_tokens (election_id, student_id, token_hash, token_encrypted, used)
           VALUES ($1, $2, $3, $4, false)`,
          [electionId, studentId, tokenHashes[index], `encrypted-token-${index}`]
        )
      )
    );

    const results = await Promise.allSettled(
      tokenHashes.map((tokenHash) =>
        pool.query('SELECT fn_cast_vote_anonymous($1, $2, $3)', [
          electionId,
          optionId,
          tokenHash,
        ])
      )
    );

    const voteCount = await pool.query<{ total: string; tokens: string }>(
      `SELECT COUNT(*) AS total, COUNT(DISTINCT token_hash) AS tokens
       FROM votes
       WHERE election_id = $1`,
      [electionId]
    );
    const clearedTokens = await pool.query<{ total: string }>(
      `SELECT COUNT(*) AS total
       FROM voting_tokens
       WHERE election_id = $1
         AND used = true
         AND used_at IS NOT NULL
         AND token_hash IS NULL
         AND token_encrypted IS NULL`,
      [electionId]
    );
    const votersMarked = await pool.query<{ total: string }>(
      `SELECT COUNT(*) AS total
       FROM election_voters
       WHERE election_id = $1 AND token_used = true AND token_used_at IS NOT NULL`,
      [electionId]
    );

    expect(countFulfilled(results)).toBe(CONCURRENT_REQUESTS);
    expect(countRejected(results)).toBe(0);
    expect(Number(voteCount.rows[0].total)).toBe(CONCURRENT_REQUESTS);
    expect(Number(voteCount.rows[0].tokens)).toBe(CONCURRENT_REQUESTS);
    expect(Number(clearedTokens.rows[0].total)).toBe(CONCURRENT_REQUESTS);
    expect(Number(votersMarked.rows[0].total)).toBe(CONCURRENT_REQUESTS);
  });
});
