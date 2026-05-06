import type { Pool } from 'pg';
import type { ElectionStatus, VoterSource } from '../fixtures/elections';
import type { DbStudent, StudentFixture } from '../fixtures/users';
import {
  deleteStudentsByIdentity,
  insertStudentFixture,
  type QueryClient,
  withTransaction,
} from './db';

export function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

export function futureIso(hoursFromNowValue: number): string {
  return hoursFromNow(hoursFromNowValue);
}

export async function cleanupAuditLogsByMarker(
  client: QueryClient,
  marker: string
): Promise<void> {
  await client.query(
    `DELETE FROM audit_logs
     WHERE action LIKE 'E2E.%'
        OR resource_id LIKE 'E2E_%'
        OR details::text LIKE $1`,
    [`%${marker}%`]
  );
}

export async function cleanupElectionsByTitlePrefix(
  client: QueryClient,
  titlePrefix: string
): Promise<string[]> {
  const electionIds = await client.query<{ id: string }>(
    'SELECT id FROM elections WHERE title LIKE $1',
    [`${titlePrefix}%`]
  );
  const ids = electionIds.rows.map((row) => row.id);

  await client.query(
    `DELETE FROM audit_logs
     WHERE resource_id = ANY($1::text[])
        OR details::text LIKE $2`,
    [ids, `%${titlePrefix}%`]
  );

  if (ids.length > 0) {
    await client.query('DELETE FROM scrutiny_keys WHERE election_id = ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM voting_tokens WHERE election_id = ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM votes WHERE election_id = ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM election_voters WHERE election_id = ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM election_options WHERE election_id = ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM elections WHERE id = ANY($1::uuid[])', [ids]);
  }

  await client.query(
    `DELETE FROM audit_logs
     WHERE resource_id = ANY($1::text[])
        OR details::text LIKE $2`,
    [ids, `%${titlePrefix}%`]
  );

  return ids;
}

export async function resetStudentFixtures(
  pool: Pool,
  students: StudentFixture[]
): Promise<DbStudent[]> {
  const emails = students.map((student) => student.email);
  const carnets = students.map((student) => student.carnet);

  await withTransaction(pool, async (client) => {
    await deleteStudentsByIdentity(client, { emails, carnets });

    for (const student of students) {
      await insertStudentFixture(client, student);
    }
  });

  const result = await pool.query<DbStudent>(
    `SELECT id, carnet, full_name, email, sede, career, degree_level
     FROM students
     WHERE email = ANY($1::text[])
     ORDER BY carnet ASC`,
    [emails]
  );

  if (result.rows.length !== students.length) {
    throw new Error('Could not seed all E2E student fixtures.');
  }

  return result.rows;
}

export interface BasicElectionInput {
  title: string;
  description: string;
  status?: ElectionStatus;
  isAnonymous?: boolean;
  voterSource?: VoterSource;
  createdBy: string;
  voterIds?: string[];
  requiresKeys?: boolean;
  minKeys?: number;
  options: string[];
}

export interface SeededBasicElection {
  id: string;
  title: string;
  optionIds: string[];
}

export async function createBasicElection(
  pool: Pool,
  input: BasicElectionInput
): Promise<SeededBasicElection> {
  return withTransaction(pool, async (client) => {
    const status = input.status ?? 'OPEN';
    const startsInPast = status !== 'SCHEDULED';
    const endsInFuture = status === 'OPEN' || status === 'SCHEDULED';
    const startTime = startsInPast ? hoursFromNow(-1) : hoursFromNow(1);
    const endTime = endsInFuture ? hoursFromNow(2) : hoursFromNow(-0.5);

    const election = await client.query<{ id: string }>(
      `INSERT INTO elections (
         title, description, status, is_anonymous, auth_method, voter_source,
         starts_immediately, requires_keys, min_keys, start_time, end_time, created_by
       )
       VALUES ($1, $2, $3::election_status, $4, 'MICROSOFT'::auth_method_type, $5::voter_source_type,
         false, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        input.title,
        input.description,
        status,
        input.isAnonymous ?? false,
        input.voterSource ?? 'MANUAL',
        input.requiresKeys ?? false,
        input.minKeys ?? 1,
        startTime,
        endTime,
        input.createdBy,
      ]
    );
    const electionId = election.rows[0].id;
    const optionIds: string[] = [];

    for (const [index, label] of input.options.entries()) {
      const option = await client.query<{ id: string }>(
        `INSERT INTO election_options (election_id, label, option_type, display_order)
         VALUES ($1, $2, 'CANDIDATE', $3)
         RETURNING id`,
        [electionId, label, index + 1]
      );
      optionIds.push(option.rows[0].id);
    }

    for (const voterId of input.voterIds ?? []) {
      await client.query(
        `INSERT INTO election_voters (election_id, student_id, token_used, token_used_at)
         VALUES ($1, $2, false, NULL)
         ON CONFLICT (election_id, student_id) DO UPDATE
           SET token_used = false, token_used_at = NULL`,
        [electionId, voterId]
      );
    }

    return {
      id: electionId,
      title: input.title,
      optionIds,
    };
  });
}

