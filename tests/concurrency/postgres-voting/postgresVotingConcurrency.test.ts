import crypto from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

const CONCURRENT_CALLS = 50;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run postgres voting concurrency tests.');
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: CONCURRENT_CALLS + 5,
  connectionTimeoutMillis: 5_000,
});

type Fixture = {
  electionId: string;
  optionId: string;
  studentIds: string[];
  tokenHashes: string[];
};

type CountRow = {
  count: number;
};

function uuid(): string {
  return crypto.randomUUID();
}

function testSuffix(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

function hashToken(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function rejectedResults<T>(results: PromiseSettledResult<T>[]): PromiseRejectedResult[] {
  return results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
}

function fulfilledResults<T>(results: PromiseSettledResult<T>[]): PromiseFulfilledResult<T>[] {
  return results.filter((result): result is PromiseFulfilledResult<T> => result.status === 'fulfilled');
}

function errorSnapshot(reason: unknown) {
  const error = reason as { code?: string; constraint?: string; message?: string };
  return {
    code: error.code,
    constraint: error.constraint,
    message: error.message,
  };
}

async function assertDatabaseHasVotingFunctions() {
  const result = await pool.query<{
    named_fn: string | null;
    anonymous_fn: string | null;
  }>(`
    SELECT
      to_regprocedure('fn_cast_vote_named(uuid, uuid, uuid)')::text AS named_fn,
      to_regprocedure('fn_cast_vote_anonymous(uuid, uuid, text)')::text AS anonymous_fn
  `);

  expect(result.rows[0]).toMatchObject({
    named_fn: 'fn_cast_vote_named(uuid,uuid,uuid)',
    anonymous_fn: 'fn_cast_vote_anonymous(uuid,uuid,text)',
  });
}

async function createElection(isAnonymous: boolean, suffix: string): Promise<Pick<Fixture, 'electionId' | 'optionId'>> {
  const electionId = uuid();
  const optionId = uuid();

  await pool.query(
    `INSERT INTO elections (
       id, title, description, status, is_anonymous, voter_source,
       starts_immediately, requires_keys, min_keys, start_time, end_time
     )
     VALUES (
       $1, $2, $3, 'OPEN', $4, 'MANUAL',
       true, false, 1, now() - interval '1 minute', now() + interval '1 hour'
     )`,
    [
      electionId,
      `Postgres concurrency ${suffix}`,
      'Fixture created by postgres voting concurrency tests',
      isAnonymous,
    ]
  );

  await pool.query(
    `INSERT INTO election_options (id, election_id, label, option_type, display_order, metadata)
     VALUES ($1, $2, 'Opcion unica', 'candidate', 1, '{}'::jsonb)`,
    [optionId, electionId]
  );

  return { electionId, optionId };
}

async function createStudents(count: number, suffix: string): Promise<string[]> {
  const studentIds = Array.from({ length: count }, () => uuid());
  const carnets = studentIds.map((_, index) => `PGCON-${suffix}-${index + 1}`);
  const names = studentIds.map((_, index) => `Postgres Concurrency Voter ${index + 1}`);
  const emails = studentIds.map((_, index) => `pgcon-${suffix}-${index + 1}@estudiantec.cr`);
  const sedes = studentIds.map(() => 'Central');
  const careers = studentIds.map(() => 'Computacion');
  const degrees = studentIds.map(() => 'Bachillerato');
  const active = studentIds.map(() => true);

  await pool.query(
    `INSERT INTO students (id, carnet, full_name, email, sede, career, degree_level, is_active)
     SELECT *
     FROM unnest(
       $1::uuid[],
       $2::text[],
       $3::text[],
       $4::text[],
       $5::text[],
       $6::text[],
       $7::text[],
       $8::boolean[]
     )`,
    [studentIds, carnets, names, emails, sedes, careers, degrees, active]
  );

  return studentIds;
}

async function insertElectionVoters(electionId: string, studentIds: string[]) {
  await pool.query(
    `INSERT INTO election_voters (election_id, student_id)
     SELECT $1::uuid, voter.student_id
     FROM unnest($2::uuid[]) AS voter(student_id)`,
    [electionId, studentIds]
  );
}

async function insertVotingTokens(electionId: string, studentIds: string[], tokenHashes: string[]) {
  const encryptedTokens = tokenHashes.map((tokenHash) => `encrypted:${tokenHash}`);

  await pool.query(
    `INSERT INTO voting_tokens (election_id, student_id, token_hash, token_encrypted)
     SELECT $1::uuid, token.student_id, token.token_hash, token.token_encrypted
     FROM unnest($2::uuid[], $3::text[], $4::text[]) AS token(student_id, token_hash, token_encrypted)`,
    [electionId, studentIds, tokenHashes, encryptedTokens]
  );
}

async function createNamedFixture(voterCount: number): Promise<Fixture> {
  const suffix = testSuffix();
  const { electionId, optionId } = await createElection(false, suffix);
  const studentIds = await createStudents(voterCount, suffix);
  await insertElectionVoters(electionId, studentIds);

  return {
    electionId,
    optionId,
    studentIds,
    tokenHashes: [],
  };
}

async function createAnonymousFixture(voterCount: number): Promise<Fixture> {
  const suffix = testSuffix();
  const { electionId, optionId } = await createElection(true, suffix);
  const studentIds = await createStudents(voterCount, suffix);
  const tokenHashes = studentIds.map((studentId) => hashToken(`${suffix}:${studentId}`));

  await insertElectionVoters(electionId, studentIds);
  await insertVotingTokens(electionId, studentIds, tokenHashes);

  return {
    electionId,
    optionId,
    studentIds,
    tokenHashes,
  };
}

async function cleanupFixture(fixture: Fixture) {
  const auditResourceIds = [fixture.electionId, fixture.optionId, ...fixture.studentIds];

  await pool.query('DELETE FROM votes WHERE election_id = $1', [fixture.electionId]);
  await pool.query('DELETE FROM voting_tokens WHERE election_id = $1', [fixture.electionId]);
  await pool.query('DELETE FROM election_voters WHERE election_id = $1', [fixture.electionId]);
  await pool.query('DELETE FROM election_options WHERE election_id = $1 OR id = $2', [
    fixture.electionId,
    fixture.optionId,
  ]);
  await pool.query('DELETE FROM elections WHERE id = $1', [fixture.electionId]);
  await pool.query('DELETE FROM students WHERE id = ANY($1::uuid[])', [fixture.studentIds]);
  await pool.query('DELETE FROM audit_logs WHERE resource_id = ANY($1::text[])', [auditResourceIds]);
}

async function countVotes(electionId: string): Promise<number> {
  const result = await pool.query<CountRow>(
    'SELECT COUNT(*)::int AS count FROM votes WHERE election_id = $1',
    [electionId]
  );
  return result.rows[0]?.count ?? 0;
}

async function countVotersMarkedUsed(electionId: string): Promise<number> {
  const result = await pool.query<CountRow>(
    `SELECT COUNT(*)::int AS count
     FROM election_voters
     WHERE election_id = $1 AND token_used = true AND token_used_at IS NOT NULL`,
    [electionId]
  );
  return result.rows[0]?.count ?? 0;
}

async function countDistinctVoteIdentities(electionId: string) {
  const result = await pool.query<{
    distinct_students: number;
    distinct_tokens: number;
  }>(
    `SELECT
       COUNT(DISTINCT student_id)::int AS distinct_students,
       COUNT(DISTINCT token_hash)::int AS distinct_tokens
     FROM votes
     WHERE election_id = $1`,
    [electionId]
  );
  return result.rows[0] ?? { distinct_students: 0, distinct_tokens: 0 };
}

async function countClearedUsedTokens(electionId: string): Promise<number> {
  const result = await pool.query<CountRow>(
    `SELECT COUNT(*)::int AS count
     FROM voting_tokens
     WHERE election_id = $1
       AND used = true
       AND used_at IS NOT NULL
       AND token_hash IS NULL
       AND token_encrypted IS NULL`,
    [electionId]
  );
  return result.rows[0]?.count ?? 0;
}

describe('postgres voting stored procedure concurrency', () => {
  beforeAll(async () => {
    await pool.query('SELECT 1');
    await assertDatabaseHasVotingFunctions();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('allows only one of 50 concurrent direct fn_cast_vote_named calls for the same voter', async () => {
    const fixture = await createNamedFixture(1);

    try {
      const studentId = fixture.studentIds[0];
      const results = await Promise.allSettled(
        Array.from({ length: CONCURRENT_CALLS }, () =>
          pool.query('SELECT fn_cast_vote_named($1, $2, $3)', [
            fixture.electionId,
            fixture.optionId,
            studentId,
          ])
        )
      );

      const rejected = rejectedResults(results);
      expect(fulfilledResults(results)).toHaveLength(1);
      expect(rejected.map(({ reason }) => errorSnapshot(reason))).toEqual(
        Array.from({ length: CONCURRENT_CALLS - 1 }, () => ({
          code: '23505',
          constraint: 'uniq_votes_student',
          message: expect.stringContaining('duplicate key value'),
        }))
      );
      expect(await countVotes(fixture.electionId)).toBe(1);
      expect(await countVotersMarkedUsed(fixture.electionId)).toBe(1);
      expect(await countDistinctVoteIdentities(fixture.electionId)).toEqual({
        distinct_students: 1,
        distinct_tokens: 0,
      });
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it('records all votes when 50 different voters call fn_cast_vote_named concurrently', async () => {
    const fixture = await createNamedFixture(CONCURRENT_CALLS);

    try {
      const results = await Promise.allSettled(
        fixture.studentIds.map((studentId) =>
          pool.query('SELECT fn_cast_vote_named($1, $2, $3)', [
            fixture.electionId,
            fixture.optionId,
            studentId,
          ])
        )
      );

      expect(rejectedResults(results).map(({ reason }) => errorSnapshot(reason))).toEqual([]);
      expect(fulfilledResults(results)).toHaveLength(CONCURRENT_CALLS);
      expect(await countVotes(fixture.electionId)).toBe(CONCURRENT_CALLS);
      expect(await countVotersMarkedUsed(fixture.electionId)).toBe(CONCURRENT_CALLS);
      expect(await countDistinctVoteIdentities(fixture.electionId)).toEqual({
        distinct_students: CONCURRENT_CALLS,
        distinct_tokens: 0,
      });
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it('allows only one of 50 concurrent direct fn_cast_vote_anonymous calls for the same token', async () => {
    const fixture = await createAnonymousFixture(1);

    try {
      const tokenHash = fixture.tokenHashes[0];
      const results = await Promise.allSettled(
        Array.from({ length: CONCURRENT_CALLS }, () =>
          pool.query('SELECT fn_cast_vote_anonymous($1, $2, $3)', [
            fixture.electionId,
            fixture.optionId,
            tokenHash,
          ])
        )
      );

      const rejected = rejectedResults(results);
      expect(fulfilledResults(results)).toHaveLength(1);
      expect(rejected.map(({ reason }) => errorSnapshot(reason))).toEqual(
        Array.from({ length: CONCURRENT_CALLS - 1 }, () => ({
          code: 'P0001',
          constraint: undefined,
          message: expect.stringContaining('Token'),
        }))
      );
      expect(await countVotes(fixture.electionId)).toBe(1);
      expect(await countVotersMarkedUsed(fixture.electionId)).toBe(1);
      expect(await countClearedUsedTokens(fixture.electionId)).toBe(1);
      expect(await countDistinctVoteIdentities(fixture.electionId)).toEqual({
        distinct_students: 0,
        distinct_tokens: 1,
      });
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it('records all votes when 50 different tokens call fn_cast_vote_anonymous concurrently', async () => {
    const fixture = await createAnonymousFixture(CONCURRENT_CALLS);

    try {
      const results = await Promise.allSettled(
        fixture.tokenHashes.map((tokenHash) =>
          pool.query('SELECT fn_cast_vote_anonymous($1, $2, $3)', [
            fixture.electionId,
            fixture.optionId,
            tokenHash,
          ])
        )
      );

      expect(rejectedResults(results).map(({ reason }) => errorSnapshot(reason))).toEqual([]);
      expect(fulfilledResults(results)).toHaveLength(CONCURRENT_CALLS);
      expect(await countVotes(fixture.electionId)).toBe(CONCURRENT_CALLS);
      expect(await countVotersMarkedUsed(fixture.electionId)).toBe(CONCURRENT_CALLS);
      expect(await countClearedUsedTokens(fixture.electionId)).toBe(CONCURRENT_CALLS);
      expect(await countDistinctVoteIdentities(fixture.electionId)).toEqual({
        distinct_students: 0,
        distinct_tokens: CONCURRENT_CALLS,
      });
    } finally {
      await cleanupFixture(fixture);
    }
  });
});
