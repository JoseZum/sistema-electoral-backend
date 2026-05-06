import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { Pool, type PoolClient } from 'pg';

dotenv.config();

const FRONTEND_URL =
  process.env.E2E_FRONTEND_URL ||
  process.env.PLAYWRIGHT_BASE_URL ||
  'http://localhost:3000';

const BACKEND_URL =
  process.env.E2E_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:3001';

const DATABASE_URL = process.env.E2E_DATABASE_URL || process.env.DATABASE_URL;

type E2ERole = 'admin' | 'voter';

interface DbStudent {
  id: string;
  carnet: string;
  full_name: string;
  email: string;
  sede: string;
  career: string;
  degree_level: string;
}

interface E2EUser {
  studentId: string;
  carnet: string;
  fullName: string;
  email: string;
  role: E2ERole;
  sede: string;
  career: string;
}

interface StudentsResponse {
  students: DbStudent[];
  total: number;
}

const padronFixture = {
  carnet: '2099999001',
  full_name: 'E2E Padron Persona Base',
  email: 'e2e.padron.persona@estudiantec.cr',
  sede: 'Cartago',
  career: 'Ingenieria en Computacion',
  degree_level: 'Bachillerato',
};

let pool: Pool;
let adminUser: E2EUser;
let voterUser: E2EUser;
let adminToken: string;
let voterToken: string;

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      'JWT_SECRET is required to create E2E storage sessions. Set it to the same value used by the backend.'
    );
  }
  return secret;
}

function createSessionToken(user: E2EUser): string {
  const { studentId, carnet, email, fullName, role } = user;

  return jwt.sign(
    {
      studentId,
      carnet,
      email,
      fullName,
      role,
    },
    getJwtSecret(),
    {
      expiresIn: '8h',
      issuer: 'tee-voting-system',
    }
  );
}

function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
  };
}

function toE2EUser(student: DbStudent, role: E2ERole): E2EUser {
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

async function seedStoredSession(page: Page, user: E2EUser): Promise<void> {
  const token = createSessionToken(user);

  await page.addInitScript(
    ({ storageToken, storageUser }) => {
      window.localStorage.setItem('tee_token', storageToken);
      window.localStorage.setItem('tee_user', JSON.stringify(storageUser));
    },
    {
      storageToken: token,
      storageUser: user,
    }
  );
}

async function loadAdminUser(): Promise<E2EUser> {
  const result = await pool.query<DbStudent>(
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

async function loadVoterUser(): Promise<E2EUser> {
  const result = await pool.query<DbStudent>(
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

async function cleanupPadronFixture(client: PoolClient | Pool = pool): Promise<void> {
  const target = [padronFixture.email, padronFixture.carnet];

  await client.query(
    'DELETE FROM voting_tokens WHERE student_id IN (SELECT id FROM students WHERE email = $1 OR carnet = $2)',
    target
  );
  await client.query(
    'DELETE FROM votes WHERE student_id IN (SELECT id FROM students WHERE email = $1 OR carnet = $2)',
    target
  );
  await client.query(
    'DELETE FROM election_voters WHERE student_id IN (SELECT id FROM students WHERE email = $1 OR carnet = $2)',
    target
  );
  await client.query(
    'DELETE FROM tag_members WHERE student_id IN (SELECT id FROM students WHERE email = $1 OR carnet = $2)',
    target
  );
  await client.query(
    'DELETE FROM scrutiny_keys WHERE member_id IN (SELECT id FROM students WHERE email = $1 OR carnet = $2)',
    target
  );
  await client.query(
    'DELETE FROM admins WHERE students_id IN (SELECT id FROM students WHERE email = $1 OR carnet = $2)',
    target
  );
  await client.query('DELETE FROM students WHERE email = $1 OR carnet = $2', target);
}

async function resetPadronFixture(): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await cleanupPadronFixture(client);
    await client.query(
      `INSERT INTO students (carnet, full_name, email, sede, career, degree_level, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true)`,
      [
        padronFixture.carnet,
        padronFixture.full_name,
        padronFixture.email,
        padronFixture.sede,
        padronFixture.career,
        padronFixture.degree_level,
      ]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function findFixtureThroughApi(request: APIRequestContext): Promise<DbStudent> {
  const response = await request.get(
    `${BACKEND_URL}/api/users/students?search=${encodeURIComponent(padronFixture.carnet)}&limit=5`,
    {
      headers: authHeaders(adminToken),
    }
  );
  const body = (await response.json()) as StudentsResponse;
  const student = body.students.find((item) => item.email === padronFixture.email);

  expect(response.status()).toBe(200);
  expect(student).toBeTruthy();

  return student as DbStudent;
}

test.describe.configure({ mode: 'serial' });

test.describe('padron e2e', () => {
  test.beforeAll(async () => {
    if (!DATABASE_URL) {
      throw new Error('DATABASE_URL or E2E_DATABASE_URL is required for padron E2E tests.');
    }

    pool = new Pool({ connectionString: DATABASE_URL });
    adminUser = await loadAdminUser();
    voterUser = await loadVoterUser();
    adminToken = createSessionToken(adminUser);
    voterToken = createSessionToken(voterUser);
  });

  test.beforeEach(async () => {
    await resetPadronFixture();
  });

  test.afterAll(async () => {
    if (pool) {
      await cleanupPadronFixture();
      await pool.end();
    }
  });

  test('backend protects padron endpoints from anonymous and non-admin users', async ({ request }) => {
    const anonymous = await request.get(`${BACKEND_URL}/api/users/students`);
    const anonymousBody = await anonymous.json();

    expect(anonymous.status()).toBe(401);
    expect(anonymousBody).toEqual(expect.objectContaining({ error: expect.any(String) }));

    const voter = await request.get(`${BACKEND_URL}/api/users/students`, {
      headers: authHeaders(voterToken),
    });
    const voterBody = await voter.json();

    expect(voter.status()).toBe(403);
    expect(voterBody).toEqual(expect.objectContaining({ error: expect.any(String) }));
  });

  test('admin API lists, filters and updates a deterministic student', async ({ request }) => {
    const listed = await request.get(
      `${BACKEND_URL}/api/users/students?search=${padronFixture.carnet}&sede=${padronFixture.sede}&career=${encodeURIComponent(padronFixture.career)}&limit=5`,
      {
        headers: authHeaders(adminToken),
      }
    );
    const listedBody = (await listed.json()) as StudentsResponse;
    const student = listedBody.students.find((item) => item.email === padronFixture.email);

    expect(listed.status()).toBe(200);
    expect(student).toEqual(
      expect.objectContaining({
        carnet: padronFixture.carnet,
        full_name: padronFixture.full_name,
        sede: padronFixture.sede,
        career: padronFixture.career,
      })
    );

    const excluded = await request.get(
      `${BACKEND_URL}/api/users/students?search=${padronFixture.carnet}&sede=San%20Jose&limit=5`,
      {
        headers: authHeaders(adminToken),
      }
    );
    const excludedBody = (await excluded.json()) as StudentsResponse;

    expect(excluded.status()).toBe(200);
    expect(excludedBody.students.some((item) => item.email === padronFixture.email)).toBe(false);

    const updatedName = 'E2E Padron Persona Actualizada';
    const update = await request.put(`${BACKEND_URL}/api/users/students/${student?.id}`, {
      headers: authHeaders(adminToken),
      data: {
        full_name: updatedName,
        degree_level: 'Licenciatura',
      },
    });
    const updateBody = (await update.json()) as DbStudent;

    expect(update.status()).toBe(200);
    expect(updateBody).toEqual(
      expect.objectContaining({
        email: padronFixture.email,
        full_name: updatedName,
        degree_level: 'Licenciatura',
      })
    );
  });

  test('admin UI searches the padron and displays the deterministic student', async ({ page }) => {
    await seedStoredSession(page, adminUser);
    await page.goto(`${FRONTEND_URL}/padron`);

    await expect(page.getByRole('heading', { name: /Padr.n Estudiantil/i })).toBeVisible();
    await page.getByLabel(/Buscar estudiantes por carnet o nombre/i).fill(padronFixture.carnet);

    const row = page.getByRole('row').filter({ hasText: padronFixture.carnet });
    await expect(row).toBeVisible();
    await expect(row.getByRole('cell', { name: padronFixture.carnet })).toBeVisible();
    await expect(row.getByRole('cell', { name: padronFixture.full_name, exact: true })).toBeVisible();
    await expect(row.getByRole('cell', { name: padronFixture.sede })).toBeVisible();
  });

  test('admin UI applies sede and career filters', async ({ page }) => {
    await seedStoredSession(page, adminUser);
    await page.goto(`${FRONTEND_URL}/padron`);

    await expect(page.getByLabel(/Filtrar por sede/i)).toContainText(padronFixture.sede);
    await expect(page.getByLabel(/Filtrar por carrera/i)).toContainText(padronFixture.career);

    await page.getByLabel(/Filtrar por sede/i).selectOption(padronFixture.sede);
    await page.getByLabel(/Filtrar por carrera/i).selectOption(padronFixture.career);
    await page.getByLabel(/Buscar estudiantes por carnet o nombre/i).fill(padronFixture.carnet);

    await expect(
      page
        .getByRole('row')
        .filter({ hasText: padronFixture.carnet })
        .getByRole('cell', { name: padronFixture.full_name, exact: true })
    ).toBeVisible();

    await page.getByLabel(/Buscar estudiantes por carnet o nombre/i).fill('E2E_PADRON_NO_EXISTE');
    await expect(page.getByText(/No se encontraron estudiantes/i)).toBeVisible();
  });

  test('admin UI edits a student row and persists the change through the backend', async ({
    page,
    request,
  }) => {
    const updatedName = 'E2E Padron Persona Editada UI';

    await seedStoredSession(page, adminUser);
    await page.goto(`${FRONTEND_URL}/padron`);
    await page.getByLabel(/Buscar estudiantes por carnet o nombre/i).fill(padronFixture.carnet);
    await expect(page.getByRole('cell', { name: padronFixture.full_name, exact: true })).toBeVisible();

    await page.getByRole('button', { name: `Editar estudiante ${padronFixture.full_name}` }).click();
    const editingRow = page.getByRole('row').filter({ hasText: padronFixture.carnet });
    await editingRow.locator('input').first().fill(updatedName);

    const saveResponse = page.waitForResponse(
      (response) =>
        response.url().startsWith(`${BACKEND_URL}/api/users/students/`) &&
        response.request().method() === 'PUT' &&
        response.status() === 200
    );
    await editingRow.getByRole('button', { name: 'OK' }).click({ force: true });
    await saveResponse;

    await expect(
      page
        .getByRole('row')
        .filter({ hasText: padronFixture.carnet })
        .getByRole('cell', { name: updatedName, exact: true })
    ).toBeVisible();

    const student = await findFixtureThroughApi(request);
    expect(student.full_name).toBe(updatedName);
  });
});
