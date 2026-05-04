import { createHash, randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';

export const CONCURRENT_REQUESTS = 50;

export type TestIds = {
  electionIds: string[];
  studentIds: string[];
};

export function createTestIds(): TestIds {
  return {
    electionIds: [],
    studentIds: [],
  };
}

export function createPool(): Pool {
  return new Pool({
    connectionString:
      process.env.DATABASE_URL ||
      'postgresql://tee_admin:tee_local_password@localhost:5432/tee_voting',
    max: CONCURRENT_REQUESTS + 10,
  });
}

export async function applyVotingStoredProcedures(pool: Pool): Promise<void> {
  const sql = readFileSync(
    join(process.cwd(), 'supabase', 'schema', '02-storedprocedures.sql'),
    'utf8'
  );
  await pool.query(sql);
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function newUuid(ids?: string[]): string {
  const id = randomUUID();
  ids?.push(id);
  return id;
}

export async function cleanupTestData(pool: Pool, ids: TestIds): Promise<void> {
  await pool.query('DELETE FROM audit_logs WHERE resource_id = ANY($1::text[])', [
    ids.electionIds,
  ]);
  await pool.query(
    'DELETE FROM scrutiny_keys WHERE election_id = ANY($1::uuid[]) OR member_id = ANY($2::uuid[])',
    [ids.electionIds, ids.studentIds]
  );
  await pool.query(
    'DELETE FROM votes WHERE election_id = ANY($1::uuid[]) OR student_id = ANY($2::uuid[])',
    [ids.electionIds, ids.studentIds]
  );
  await pool.query(
    'DELETE FROM voting_tokens WHERE election_id = ANY($1::uuid[]) OR student_id = ANY($2::uuid[])',
    [ids.electionIds, ids.studentIds]
  );
  await pool.query(
    'DELETE FROM election_voters WHERE election_id = ANY($1::uuid[]) OR student_id = ANY($2::uuid[])',
    [ids.electionIds, ids.studentIds]
  );
  await pool.query('DELETE FROM election_options WHERE election_id = ANY($1::uuid[])', [
    ids.electionIds,
  ]);
  await pool.query('DELETE FROM elections WHERE id = ANY($1::uuid[])', [ids.electionIds]);
  await pool.query('DELETE FROM admins WHERE students_id = ANY($1::uuid[])', [ids.studentIds]);
  await pool.query('DELETE FROM students WHERE id = ANY($1::uuid[])', [ids.studentIds]);
}

export async function insertStudent(
  pool: Pool,
  ids: TestIds,
  overrides: Partial<{
    id: string;
    carnet: string;
    full_name: string;
    email: string;
    sede: string;
    career: string;
    degree_level: string;
  }> = {}
): Promise<string> {
  const id = overrides.id || newUuid(ids.studentIds);
  if (!ids.studentIds.includes(id)) {
    ids.studentIds.push(id);
  }

  const suffix = id.slice(0, 8);
  await pool.query(
    `INSERT INTO students (id, carnet, full_name, email, sede, career, degree_level, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
    [
      id,
      overrides.carnet || `TC${suffix}`,
      overrides.full_name || `Concurrent Student ${suffix}`,
      overrides.email || `concurrent-${suffix}@estudiantec.cr`,
      overrides.sede || 'Cartago',
      overrides.career || 'Ingenieria en Computacion',
      overrides.degree_level || 'Bachillerato',
    ]
  );

  return id;
}

export async function insertElection(
  pool: Pool,
  ids: TestIds,
  overrides: Partial<{
    id: string;
    title: string;
    status: string;
    is_anonymous: boolean;
    voter_source: string;
    requires_keys: boolean;
    min_keys: number;
    start_time: Date;
    end_time: Date;
  }> = {}
): Promise<string> {
  const id = overrides.id || newUuid(ids.electionIds);
  if (!ids.electionIds.includes(id)) {
    ids.electionIds.push(id);
  }

  await pool.query(
    `INSERT INTO elections (
       id, title, status, is_anonymous, auth_method, voter_source,
       requires_keys, min_keys, start_time, end_time
     )
     VALUES (
       $1, $2, $3::election_status, $4, 'MICROSOFT', $5::voter_source_type,
       $6, $7, $8, $9
     )`,
    [
      id,
      overrides.title || `Concurrent Election ${id.slice(0, 8)}`,
      overrides.status || 'OPEN',
      overrides.is_anonymous ?? false,
      overrides.voter_source || 'MANUAL',
      overrides.requires_keys ?? false,
      overrides.min_keys || 1,
      overrides.start_time || new Date('2026-05-04T12:00:00.000Z'),
      overrides.end_time || new Date('2026-05-05T12:00:00.000Z'),
    ]
  );

  return id;
}

export async function insertOption(
  pool: Pool,
  electionId: string,
  label = 'Opcion concurrente'
): Promise<string> {
  const optionId = randomUUID();
  await pool.query(
    `INSERT INTO election_options (id, election_id, label, option_type, display_order)
     VALUES ($1, $2, $3, 'ticket', 1)`,
    [optionId, electionId, label]
  );
  return optionId;
}

export async function insertElectionVoter(
  pool: Pool,
  electionId: string,
  studentId: string
): Promise<void> {
  await pool.query(
    `INSERT INTO election_voters (election_id, student_id, token_used)
     VALUES ($1, $2, false)`,
    [electionId, studentId]
  );
}

export function countFulfilled<T>(results: PromiseSettledResult<T>[]): number {
  return results.filter((result) => result.status === 'fulfilled').length;
}

export function countRejected<T>(results: PromiseSettledResult<T>[]): number {
  return results.filter((result) => result.status === 'rejected').length;
}
