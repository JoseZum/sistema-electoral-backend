import { createHash, randomUUID } from 'crypto';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { pool } from '../../../src/config/database';
import {
  checkKey,
  finalizeScrutine,
  submitKeys,
} from '../../../src/modules/scrutiny/repositories/scrutinyRepository';

const CONCURRENT_REQUESTS = 50;

type ScrutinyMember = {
  id: string;
  plainKey: string;
};

type Fixture = {
  electionId: string;
  members: ScrutinyMember[];
};

const createdElectionIds = new Set<string>();
const createdStudentIds = new Set<string>();

function hashKey(key: string) {
  return createHash('sha256').update(key).digest('hex');
}

function resultCode(result: PromiseSettledResult<unknown>) {
  return result.status === 'rejected' && result.reason && typeof result.reason === 'object'
    ? (result.reason as { code?: string }).code
    : undefined;
}

function codedError(code: string) {
  return Object.assign(new Error(code), { code });
}

async function submitScrutinyKeyDirect(electionId: string, member: ScrutinyMember) {
  const payload = {
    election_id: electionId,
    member_id: member.id,
    key_shard: member.plainKey,
  };
  const isValid = await checkKey(payload, hashKey(member.plainKey));

  if (!isValid) {
    throw codedError('SCRUTINY_KEY_INVALID');
  }

  const submittedKey = await submitKeys(payload);

  if (!submittedKey) {
    throw codedError('SCRUTINY_KEY_NOT_FOUND');
  }

  return submittedKey;
}

async function cleanupCreatedRows() {
  const electionIds = [...createdElectionIds];
  const studentIds = [...createdStudentIds];

  if (electionIds.length > 0) {
    await pool.query('DELETE FROM scrutiny_keys WHERE election_id = ANY($1::uuid[])', [
      electionIds,
    ]);
    await pool.query('DELETE FROM voting_tokens WHERE election_id = ANY($1::uuid[])', [
      electionIds,
    ]);
    await pool.query('DELETE FROM votes WHERE election_id = ANY($1::uuid[])', [
      electionIds,
    ]);
    await pool.query('DELETE FROM election_voters WHERE election_id = ANY($1::uuid[])', [
      electionIds,
    ]);
    await pool.query('DELETE FROM election_options WHERE election_id = ANY($1::uuid[])', [
      electionIds,
    ]);
    await pool.query('DELETE FROM elections WHERE id = ANY($1::uuid[])', [electionIds]);
  }

  if (studentIds.length > 0) {
    await pool.query('DELETE FROM admins WHERE students_id = ANY($1::uuid[])', [studentIds]);
    await pool.query('DELETE FROM students WHERE id = ANY($1::uuid[])', [studentIds]);
  }

  if (electionIds.length > 0 || studentIds.length > 0) {
    await pool.query(
      `
      DELETE FROM audit_logs
      WHERE resource_id = ANY($1::text[])
         OR resource_id = ANY($2::text[])
         OR EXISTS (
           SELECT 1
           FROM unnest($1::text[]) AS owned_election(id)
           WHERE audit_logs.resource_id LIKE owned_election.id || ':%'
         )
      `,
      [electionIds, studentIds]
    );
  }

  createdElectionIds.clear();
  createdStudentIds.clear();
}

async function insertStudents(students: Array<{ id: string; index: number; runId: string }>) {
  if (students.length === 0) return;

  await pool.query(
    `
    INSERT INTO students (
      id,
      carnet,
      full_name,
      email,
      sede,
      career,
      degree_level,
      is_active
    )
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
    )
    `,
    [
      students.map((student) => student.id),
      students.map((student) => `SCR-${student.runId}-${student.index}`),
      students.map((student) => `Scrutiny Concurrent Member ${student.index}`),
      students.map((student) => `scrutiny-${student.runId}-${student.index}@estudiantec.cr`),
      students.map(() => 'Central'),
      students.map(() => 'Ingenieria en Computacion'),
      students.map(() => 'Bachillerato'),
      students.map(() => true),
    ]
  );
}

async function createScrutinyFixture(options: {
  keyCount: number;
  minKeys: number;
  submitted?: boolean;
}): Promise<Fixture> {
  const runId = randomUUID().replace(/-/g, '').slice(0, 12);
  const electionId = randomUUID();
  const members = Array.from({ length: options.keyCount }, (_, index) => ({
    id: randomUUID(),
    plainKey: `plain-key-${runId}-${index + 1}`,
  }));

  createdElectionIds.add(electionId);
  members.forEach((member) => createdStudentIds.add(member.id));

  await insertStudents(
    members.map((member, index) => ({
      id: member.id,
      index: index + 1,
      runId,
    }))
  );

  await pool.query(
    `
    INSERT INTO elections (
      id,
      title,
      status,
      is_anonymous,
      auth_method,
      voter_source,
      starts_immediately,
      requires_keys,
      min_keys,
      start_time,
      end_time
    )
    VALUES (
      $1,
      $2,
      'CLOSED',
      false,
      'MICROSOFT',
      'MANUAL',
      false,
      true,
      $3,
      now() - interval '2 days',
      now() - interval '1 day'
    )
    `,
    [electionId, `Scrutiny concurrency ${runId}`, options.minKeys]
  );

  await pool.query(
    `
    INSERT INTO scrutiny_keys (election_id, member_id, key_shard, has_submitted, submitted_at)
    SELECT $1::uuid,
           key_rows.member_id,
           key_rows.key_shard,
           $4::boolean,
           CASE WHEN $4::boolean THEN now() ELSE null END
    FROM unnest($2::uuid[], $3::text[]) AS key_rows(member_id, key_shard)
    `,
    [
      electionId,
      members.map((member) => member.id),
      members.map((member) => hashKey(member.plainKey)),
      Boolean(options.submitted),
    ]
  );

  return { electionId, members };
}

async function getScrutinyState(electionId: string) {
  const result = await pool.query<{
    election_status: string;
    scrutinized_at: Date | null;
    total_keys: string;
    submitted_keys: string;
    finalize_audit_count: string;
  }>(
    `
    SELECT
      e.status::text AS election_status,
      e.scrutinized_at,
      COUNT(sk.id)::text AS total_keys,
      COUNT(sk.id) FILTER (WHERE sk.has_submitted = true)::text AS submitted_keys,
      (
        SELECT COUNT(*)::text
        FROM audit_logs al
        WHERE al.action = 'scrutiny.finalize'
          AND al.resource_type = 'election'
          AND al.resource_id = e.id::text
      ) AS finalize_audit_count
    FROM elections e
    LEFT JOIN scrutiny_keys sk ON sk.election_id = e.id
    WHERE e.id = $1
    GROUP BY e.id
    `,
    [electionId]
  );

  const row = result.rows[0];
  if (!row) throw new Error(`Fixture election ${electionId} was not found`);

  return {
    electionStatus: row.election_status,
    scrutinizedAt: row.scrutinized_at,
    totalKeys: Number(row.total_keys),
    submittedKeys: Number(row.submitted_keys),
    finalizeAuditCount: Number(row.finalize_audit_count),
  };
}

describe('scrutiny concurrency with postgres', () => {
  afterEach(async () => {
    await cleanupCreatedRows();
  });

  afterAll(async () => {
    await cleanupCreatedRows();
    await pool.end();
  });

  it(
    'submits 50 different scrutiny keys at the same time without losing updates',
    async () => {
      const fixture = await createScrutinyFixture({
        keyCount: CONCURRENT_REQUESTS,
        minKeys: CONCURRENT_REQUESTS + 1,
      });

      const results = await Promise.allSettled(
        fixture.members.map((member) =>
          submitScrutinyKeyDirect(fixture.electionId, member)
        )
      );

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(
        CONCURRENT_REQUESTS
      );
      expect(results.map(resultCode).filter(Boolean)).toEqual([]);

      const state = await getScrutinyState(fixture.electionId);
      expect(state).toMatchObject({
        electionStatus: 'CLOSED',
        totalKeys: CONCURRENT_REQUESTS,
        submittedKeys: CONCURRENT_REQUESTS,
        finalizeAuditCount: 0,
      });
    },
    30_000
  );

  it(
    'allows only one of 50 simultaneous submissions for the same scrutiny key',
    async () => {
      const fixture = await createScrutinyFixture({
        keyCount: 1,
        minKeys: 2,
      });
      const member = fixture.members[0];

      const results = await Promise.allSettled(
        Array.from({ length: CONCURRENT_REQUESTS }, () =>
          submitScrutinyKeyDirect(fixture.electionId, member)
        )
      );

      const accepted = results.filter((result) => result.status === 'fulfilled');
      const rejectedCodes = results.map(resultCode).filter(Boolean);

      expect(accepted).toHaveLength(1);
      expect(rejectedCodes).toHaveLength(CONCURRENT_REQUESTS - 1);
      expect(
        rejectedCodes.every((code) =>
          ['SCRUTINY_KEY_INVALID', 'SCRUTINY_KEY_NOT_FOUND'].includes(String(code))
        )
      ).toBe(true);

      const state = await getScrutinyState(fixture.electionId);
      expect(state).toMatchObject({
        electionStatus: 'CLOSED',
        totalKeys: 1,
        submittedKeys: 1,
        finalizeAuditCount: 0,
      });
    },
    30_000
  );

  it(
    'finalizes a closed election only once under 50 simultaneous finalization attempts',
    async () => {
      const fixture = await createScrutinyFixture({
        keyCount: 3,
        minKeys: 3,
        submitted: true,
      });

      const results = await Promise.allSettled(
        Array.from({ length: CONCURRENT_REQUESTS }, (_, index) =>
          finalizeScrutine(
            fixture.electionId,
            fixture.members[index % fixture.members.length].id
          )
        )
      );

      const accepted = results.filter((result) => result.status === 'fulfilled');
      const rejectedCodes = results.map(resultCode).filter(Boolean);

      expect(accepted).toHaveLength(1);
      expect(rejectedCodes).toHaveLength(CONCURRENT_REQUESTS - 1);
      expect(new Set(rejectedCodes)).toEqual(new Set(['SCRUTINY_ELECTION_ALREADY_FINALIZED']));

      const state = await getScrutinyState(fixture.electionId);
      expect(state).toMatchObject({
        electionStatus: 'SCRUTINIZED',
        totalKeys: 3,
        submittedKeys: 3,
        finalizeAuditCount: 1,
      });
      expect(state.scrutinizedAt).toBeInstanceOf(Date);
    },
    30_000
  );
});
