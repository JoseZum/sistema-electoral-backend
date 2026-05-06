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

interface TagSummary {
  id: string;
  name: string;
  description: string | null;
  color: string;
  member_count: number;
}

interface TagMember {
  id: string;
  carnet: string;
  full_name: string;
  sede: string;
  career: string;
  degree_level: string;
  is_active: boolean;
}

interface TagDetail extends TagSummary {
  members: TagMember[];
}

const tagPrefix = 'E2E Tag';

const tagFixture = {
  name: `${tagPrefix} Base`,
  updatedName: `${tagPrefix} Actualizada`,
  uiName: `${tagPrefix} UI`,
  uiUpdatedName: `${tagPrefix} UI Editada`,
  description: 'Grupo deterministico para pruebas E2E',
  color: '#00695C',
  updatedColor: '#283593',
};

const studentFixtures = [
  {
    carnet: '2099999101',
    full_name: 'E2E Tags Persona Uno',
    email: 'e2e.tags.persona.uno@estudiantec.cr',
    sede: 'Cartago',
    career: 'Ingenieria en Computacion',
    degree_level: 'Bachillerato',
  },
  {
    carnet: '2099999102',
    full_name: 'E2E Tags Persona Dos',
    email: 'e2e.tags.persona.dos@estudiantec.cr',
    sede: 'Cartago',
    career: 'Ingenieria en Computacion',
    degree_level: 'Bachillerato',
  },
];

let pool: Pool;
let adminUser: E2EUser;
let voterUser: E2EUser;
let adminToken: string;
let voterToken: string;
let seededStudents: DbStudent[];

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

async function cleanupTagsFixture(client: PoolClient | Pool = pool): Promise<void> {
  const fixtureEmails = studentFixtures.map((student) => student.email);
  const fixtureCarnets = studentFixtures.map((student) => student.carnet);

  await client.query('DELETE FROM tags WHERE name LIKE $1', [`${tagPrefix}%`]);
  await client.query(
    'DELETE FROM voting_tokens WHERE student_id IN (SELECT id FROM students WHERE email = ANY($1::text[]) OR carnet = ANY($2::text[]))',
    [fixtureEmails, fixtureCarnets]
  );
  await client.query(
    'DELETE FROM votes WHERE student_id IN (SELECT id FROM students WHERE email = ANY($1::text[]) OR carnet = ANY($2::text[]))',
    [fixtureEmails, fixtureCarnets]
  );
  await client.query(
    'DELETE FROM election_voters WHERE student_id IN (SELECT id FROM students WHERE email = ANY($1::text[]) OR carnet = ANY($2::text[]))',
    [fixtureEmails, fixtureCarnets]
  );
  await client.query(
    'DELETE FROM tag_members WHERE student_id IN (SELECT id FROM students WHERE email = ANY($1::text[]) OR carnet = ANY($2::text[]))',
    [fixtureEmails, fixtureCarnets]
  );
  await client.query(
    'DELETE FROM scrutiny_keys WHERE member_id IN (SELECT id FROM students WHERE email = ANY($1::text[]) OR carnet = ANY($2::text[]))',
    [fixtureEmails, fixtureCarnets]
  );
  await client.query(
    'DELETE FROM admins WHERE students_id IN (SELECT id FROM students WHERE email = ANY($1::text[]) OR carnet = ANY($2::text[]))',
    [fixtureEmails, fixtureCarnets]
  );
  await client.query('DELETE FROM students WHERE email = ANY($1::text[]) OR carnet = ANY($2::text[])', [
    fixtureEmails,
    fixtureCarnets,
  ]);
}

async function resetTagsFixture(): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await cleanupTagsFixture(client);

    for (const student of studentFixtures) {
      await client.query(
        `INSERT INTO students (carnet, full_name, email, sede, career, degree_level, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, true)`,
        [
          student.carnet,
          student.full_name,
          student.email,
          student.sede,
          student.career,
          student.degree_level,
        ]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const result = await pool.query<DbStudent>(
    `SELECT id, carnet, full_name, email, sede, career, degree_level
     FROM students
     WHERE email = ANY($1::text[])
     ORDER BY carnet ASC`,
    [studentFixtures.map((student) => student.email)]
  );

  seededStudents = result.rows;
  if (seededStudents.length !== studentFixtures.length) {
    throw new Error('Could not seed all tag E2E students.');
  }
}

async function createTagThroughApi(
  request: APIRequestContext,
  overrides: Partial<{
    name: string;
    description: string;
    color: string;
    studentIds: string[];
  }> = {}
): Promise<TagDetail> {
  const response = await request.post(`${BACKEND_URL}/api/tags`, {
    headers: authHeaders(adminToken),
    data: {
      name: overrides.name || tagFixture.name,
      description: overrides.description || tagFixture.description,
      color: overrides.color || tagFixture.color,
      student_ids: overrides.studentIds || [seededStudents[0].id],
    },
  });
  const body = (await response.json()) as TagDetail;

  expect(response.status()).toBe(201);
  return body;
}

async function findTagByName(request: APIRequestContext, name: string): Promise<TagSummary | undefined> {
  const response = await request.get(`${BACKEND_URL}/api/tags`, {
    headers: authHeaders(adminToken),
  });
  const body = (await response.json()) as TagSummary[];

  expect(response.status()).toBe(200);
  return body.find((tag) => tag.name === name);
}

test.describe.configure({ mode: 'serial' });

test.describe('tags e2e', () => {
  test.beforeAll(async () => {
    if (!DATABASE_URL) {
      throw new Error('DATABASE_URL or E2E_DATABASE_URL is required for tags E2E tests.');
    }

    pool = new Pool({ connectionString: DATABASE_URL });
    adminUser = await loadAdminUser();
    voterUser = await loadVoterUser();
    adminToken = createSessionToken(adminUser);
    voterToken = createSessionToken(voterUser);
  });

  test.beforeEach(async () => {
    await resetTagsFixture();
  });

  test.afterAll(async () => {
    if (pool) {
      await cleanupTagsFixture();
      await pool.end();
    }
  });

  test('backend protects tag endpoints from anonymous and non-admin users', async ({ request }) => {
    const anonymous = await request.get(`${BACKEND_URL}/api/tags`);
    const anonymousBody = await anonymous.json();

    expect(anonymous.status()).toBe(401);
    expect(anonymousBody).toEqual(expect.objectContaining({ error: expect.any(String) }));

    const voter = await request.get(`${BACKEND_URL}/api/tags`, {
      headers: authHeaders(voterToken),
    });
    const voterBody = await voter.json();

    expect(voter.status()).toBe(403);
    expect(voterBody).toEqual(expect.objectContaining({ error: expect.any(String) }));
  });

  test('admin API creates, lists, updates and deletes a deterministic tag', async ({ request }) => {
    const created = await createTagThroughApi(request);

    expect(created).toEqual(
      expect.objectContaining({
        name: tagFixture.name,
        description: tagFixture.description,
        color: tagFixture.color,
        member_count: 1,
      })
    );
    expect(created.members.map((member) => member.carnet)).toEqual([seededStudents[0].carnet]);

    const listed = await findTagByName(request, tagFixture.name);
    expect(listed).toEqual(expect.objectContaining({ id: created.id, member_count: 1 }));

    const detail = await request.get(`${BACKEND_URL}/api/tags/${created.id}`, {
      headers: authHeaders(adminToken),
    });
    const detailBody = (await detail.json()) as TagDetail;
    expect(detail.status()).toBe(200);
    expect(detailBody.members).toHaveLength(1);

    const update = await request.put(`${BACKEND_URL}/api/tags/${created.id}`, {
      headers: authHeaders(adminToken),
      data: {
        name: tagFixture.updatedName,
        description: 'Tag actualizada por E2E',
        color: tagFixture.updatedColor,
        student_ids: seededStudents.map((student) => student.id),
      },
    });
    const updated = (await update.json()) as TagDetail;

    expect(update.status()).toBe(200);
    expect(updated).toEqual(
      expect.objectContaining({
        name: tagFixture.updatedName,
        color: tagFixture.updatedColor,
        member_count: 2,
      })
    );
    expect(updated.members.map((member) => member.carnet).sort()).toEqual(
      seededStudents.map((student) => student.carnet).sort()
    );

    const deleted = await request.delete(`${BACKEND_URL}/api/tags/${created.id}`, {
      headers: authHeaders(adminToken),
    });
    expect(deleted.status()).toBe(200);
    expect(await findTagByName(request, tagFixture.updatedName)).toBeUndefined();
  });

  test('admin API validates required tag data', async ({ request }) => {
    const missingName = await request.post(`${BACKEND_URL}/api/tags`, {
      headers: authHeaders(adminToken),
      data: {
        name: '   ',
        color: tagFixture.color,
        student_ids: [seededStudents[0].id],
      },
    });
    const missingNameBody = await missingName.json();

    expect(missingName.status()).toBe(400);
    expect(missingNameBody).toEqual(
      expect.objectContaining({
        code: 'TAG_NAME_REQUIRED',
      })
    );

    const missingMembers = await request.post(`${BACKEND_URL}/api/tags`, {
      headers: authHeaders(adminToken),
      data: {
        name: `${tagPrefix} Sin Miembros`,
        color: tagFixture.color,
        student_ids: [],
      },
    });
    const missingMembersBody = await missingMembers.json();

    expect(missingMembers.status()).toBe(400);
    expect(missingMembersBody).toEqual(
      expect.objectContaining({
        code: 'TAG_STUDENTS_REQUIRED',
      })
    );
  });

  test('admin UI creates a tag by searching and adding a padron member', async ({ page, request }) => {
    await seedStoredSession(page, adminUser);
    await page.goto(`${FRONTEND_URL}/tags`);

    await expect(page.getByRole('heading', { name: /Tags de votantes/i })).toBeVisible();
    await page.locator('input[placeholder="Ej: AGE-21-04-25"]').fill(tagFixture.uiName);
    await page.locator('textarea').first().fill(tagFixture.description);

    await page.getByLabel(/Buscar personas/i).fill(seededStudents[0].carnet);
    await page.getByRole('button', { name: /^Buscar$/ }).click();
    await expect(page.getByText(seededStudents[0].full_name)).toBeVisible();
    await page.getByRole('button', { name: /^Agregar$/ }).first().click();
    await expect(page.getByText(seededStudents[0].carnet, { exact: true })).toBeVisible();

    await page.getByRole('button', { name: /^Crear tag$/ }).click();

    await expect(page.getByText(tagFixture.uiName).first()).toBeVisible();
    await expect(page.getByText(/1 integrante/).first()).toBeVisible();

    const created = await findTagByName(request, tagFixture.uiName);
    expect(created).toEqual(expect.objectContaining({ member_count: 1 }));
  });

  test('admin UI edits and deletes an existing tag', async ({ page, request }) => {
    const created = await createTagThroughApi(request, { name: tagFixture.uiName });

    await seedStoredSession(page, adminUser);
    await page.goto(`${FRONTEND_URL}/tags`);

    await page.getByRole('button', { name: new RegExp(tagFixture.uiName) }).click();
    await page.locator('input[placeholder="Ej: AGE-21-04-25"]').fill(tagFixture.uiUpdatedName);
    await page.getByLabel(/Buscar personas/i).fill(seededStudents[1].carnet);
    await page.getByRole('button', { name: /^Buscar$/ }).click();
    await expect(page.getByText(seededStudents[1].full_name)).toBeVisible();
    await page.getByRole('button', { name: /^Agregar$/ }).first().click();

    await page.getByRole('button', { name: /^Guardar cambios$/ }).click();

    await expect(page.getByText(tagFixture.uiUpdatedName).first()).toBeVisible();
    const updated = await request.get(`${BACKEND_URL}/api/tags/${created.id}`, {
      headers: authHeaders(adminToken),
    });
    const updatedBody = (await updated.json()) as TagDetail;

    expect(updated.status()).toBe(200);
    expect(updatedBody).toEqual(
      expect.objectContaining({
        name: tagFixture.uiUpdatedName,
        member_count: 2,
      })
    );

    page.once('dialog', async (dialog) => {
      await dialog.accept();
    });
    await page.getByRole('button', { name: /^Eliminar$/ }).click();

    await expect(page.getByText(tagFixture.uiUpdatedName)).toHaveCount(0);
    expect(await findTagByName(request, tagFixture.uiUpdatedName)).toBeUndefined();
  });
});
