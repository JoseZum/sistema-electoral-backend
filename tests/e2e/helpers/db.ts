import { Pool, type PoolClient } from 'pg';
import type { DbStudent, E2ERole, E2EUser, StudentFixture } from '../fixtures/users';

export type QueryClient = Pool | PoolClient;

export function getDatabaseUrl(databaseUrl = process.env.E2E_DATABASE_URL || process.env.DATABASE_URL): string {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL or E2E_DATABASE_URL is required for E2E tests.');
  }

  return databaseUrl;
}

export function createE2EPool(databaseUrl = getDatabaseUrl()): Pool {
  return new Pool({ connectionString: databaseUrl });
}

export function toE2EUser(student: DbStudent, role: E2ERole): E2EUser {
  return {
    studentId: student.id,
    carnet: student.carnet,
    fullName: student.full_name,
    email: student.email,
    role,
    sede: student.sede,
    career: student.career,
  };
}

export async function loadAdminUser(client: QueryClient): Promise<E2EUser> {
  const result = await client.query<DbStudent>(
    `SELECT s.id, s.carnet, s.full_name, s.email, s.sede, s.career, s.degree_level
     FROM students s
     INNER JOIN admins a ON a.students_id = s.id
     WHERE s.is_active = true
     ORDER BY s.created_at ASC
     LIMIT 1`
  );

  if (!result.rows[0]) {
    throw new Error('The E2E database must contain at least one active admin student.');
  }

  return toE2EUser(result.rows[0], 'admin');
}

export async function loadVoterUser(client: QueryClient): Promise<E2EUser> {
  const result = await client.query<DbStudent>(
    `SELECT s.id, s.carnet, s.full_name, s.email, s.sede, s.career, s.degree_level
     FROM students s
     WHERE s.is_active = true
       AND NOT EXISTS (
         SELECT 1 FROM admins a WHERE a.students_id = s.id
       )
     ORDER BY s.created_at ASC
     LIMIT 1`
  );

  if (!result.rows[0]) {
    throw new Error('The E2E database must contain at least one active non-admin voter student.');
  }

  return toE2EUser(result.rows[0], 'voter');
}

export async function loadE2EUsers(client: QueryClient): Promise<{
  adminUser: E2EUser;
  voterUser: E2EUser;
}> {
  const [adminUser, voterUser] = await Promise.all([
    loadAdminUser(client),
    loadVoterUser(client),
  ]);

  return { adminUser, voterUser };
}

export async function withTransaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function insertStudentFixture(
  client: QueryClient,
  student: StudentFixture
): Promise<DbStudent> {
  const result = await client.query<DbStudent>(
    `INSERT INTO students (carnet, full_name, email, sede, career, degree_level, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, true)
     RETURNING id, carnet, full_name, email, sede, career, degree_level`,
    [
      student.carnet,
      student.full_name,
      student.email,
      student.sede,
      student.career,
      student.degree_level,
    ]
  );

  return result.rows[0];
}

export async function deleteStudentsByIdentity(
  client: QueryClient,
  {
    emails,
    carnets,
  }: {
    emails: string[];
    carnets: string[];
  }
): Promise<void> {
  await client.query(
    'DELETE FROM voting_tokens WHERE student_id IN (SELECT id FROM students WHERE email = ANY($1::text[]) OR carnet = ANY($2::text[]))',
    [emails, carnets]
  );
  await client.query(
    'DELETE FROM votes WHERE student_id IN (SELECT id FROM students WHERE email = ANY($1::text[]) OR carnet = ANY($2::text[]))',
    [emails, carnets]
  );
  await client.query(
    'DELETE FROM election_voters WHERE student_id IN (SELECT id FROM students WHERE email = ANY($1::text[]) OR carnet = ANY($2::text[]))',
    [emails, carnets]
  );
  await client.query(
    'DELETE FROM tag_members WHERE student_id IN (SELECT id FROM students WHERE email = ANY($1::text[]) OR carnet = ANY($2::text[]))',
    [emails, carnets]
  );
  await client.query(
    'DELETE FROM scrutiny_keys WHERE member_id IN (SELECT id FROM students WHERE email = ANY($1::text[]) OR carnet = ANY($2::text[]))',
    [emails, carnets]
  );
  await client.query(
    'DELETE FROM admins WHERE students_id IN (SELECT id FROM students WHERE email = ANY($1::text[]) OR carnet = ANY($2::text[]))',
    [emails, carnets]
  );
  await client.query('DELETE FROM students WHERE email = ANY($1::text[]) OR carnet = ANY($2::text[])', [
    emails,
    carnets,
  ]);
}

