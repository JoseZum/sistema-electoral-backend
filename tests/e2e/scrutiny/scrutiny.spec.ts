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

interface ElectionOptionResult {
  id: string;
  label: string;
  option_type: string;
  vote_count: number;
  percentage: number;
}

interface ScrutinyMember {
  id: string;
  full_name: string;
  carnet: string;
  date: string | null;
  has_submitted: boolean;
}

interface ScrutinyResponse {
  electionInfo: {
    id: string;
    title: string;
    status: string;
    requires_keys: boolean;
    min_keys: number;
  };
  progressScrutiny: {
    total_Members: number;
    submittedKeys: number;
    membersPending: ScrutinyMember[];
    can_finalize: boolean;
  };
  general_Metric: {
    total_votes: number;
    total_elegibles: number;
    participation_rate: number;
  };
  publication_status: string;
}

interface AssignMembersResponse {
  result: boolean;
  keys: string[];
}

interface SubmitKeyResponse {
  submitted: boolean;
  finalized: boolean;
}

interface ScrutinyResultsResponse {
  id: string;
  title: string;
  total_votes: number;
  total_elegibles: number;
  participation_rate: number;
  options: ElectionOptionResult[];
}

const electionPrefix = 'E2E Scrutiny';
const electionFixture = {
  title: `${electionPrefix} Cerrada con Llaves`,
  description: 'Eleccion deterministica para pruebas E2E de escrutinio',
  options: ['E2E Scrutiny Opcion A', 'E2E Scrutiny Opcion B'],
};

let pool: Pool;
let adminUser: E2EUser;
let voterUser: E2EUser;
let adminToken: string;
let voterToken: string;
let electionId: string;

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

function escapedFrontendUrl(): RegExp {
  return new RegExp(`${FRONTEND_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?$`);
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

async function cleanupScrutinyFixture(client: PoolClient | Pool = pool): Promise<void> {
  const electionIds = await client.query<{ id: string }>(
    'SELECT id FROM elections WHERE title LIKE $1',
    [`${electionPrefix}%`]
  );
  const ids = electionIds.rows.map((row) => row.id);

  if (ids.length === 0) {
    return;
  }

  await client.query(
    'DELETE FROM audit_logs WHERE resource_id = ANY($1::text[]) OR details::text LIKE $2',
    [ids, `%${electionPrefix}%`]
  );
  await client.query('DELETE FROM scrutiny_keys WHERE election_id = ANY($1::uuid[])', [ids]);
  await client.query('DELETE FROM voting_tokens WHERE election_id = ANY($1::uuid[])', [ids]);
  await client.query('DELETE FROM votes WHERE election_id = ANY($1::uuid[])', [ids]);
  await client.query('DELETE FROM election_voters WHERE election_id = ANY($1::uuid[])', [ids]);
  await client.query('DELETE FROM election_options WHERE election_id = ANY($1::uuid[])', [ids]);
  await client.query('DELETE FROM elections WHERE id = ANY($1::uuid[])', [ids]);
}

async function resetScrutinyFixture(): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await cleanupScrutinyFixture(client);

    const election = await client.query<{ id: string }>(
      `INSERT INTO elections
        (title, description, status, is_anonymous, auth_method, voter_source, starts_immediately,
         requires_keys, min_keys, start_time, end_time, created_by)
       VALUES
        ($1, $2, 'CLOSED'::election_status, false, 'MICROSOFT'::auth_method_type,
         'MANUAL'::voter_source_type, false, true, 1, now() - interval '2 hours',
         now() - interval '1 hour', $3)
       RETURNING id`,
      [electionFixture.title, electionFixture.description, adminUser.studentId]
    );
    electionId = election.rows[0].id;

    const optionA = await client.query<{ id: string }>(
      `INSERT INTO election_options (election_id, label, option_type, display_order)
       VALUES ($1, $2, 'single', 1)
       RETURNING id`,
      [electionId, electionFixture.options[0]]
    );

    await client.query(
      `INSERT INTO election_options (election_id, label, option_type, display_order)
       VALUES ($1, $2, 'single', 2)`,
      [electionId, electionFixture.options[1]]
    );

    await client.query(
      `INSERT INTO election_voters (election_id, student_id, token_used, token_used_at)
       VALUES
        ($1, $2, false, null),
        ($1, $3, true, now() - interval '30 minutes')`,
      [electionId, adminUser.studentId, voterUser.studentId]
    );

    await client.query(
      `INSERT INTO votes (election_id, option_id, student_id)
       VALUES ($1, $2, $3)`,
      [electionId, optionA.rows[0].id, voterUser.studentId]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function assignAdminKey(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${BACKEND_URL}/api/scrutiny/${electionId}/assign-members`, {
    headers: authHeaders(adminToken),
    data: {
      option: '1',
      students_id: [adminUser.studentId],
    },
  });
  const body = (await response.json()) as AssignMembersResponse;

  expect(response.status()).toBe(201);
  expect(body).toEqual(
    expect.objectContaining({
      result: true,
      keys: [expect.any(String)],
    })
  );

  return body.keys[0];
}

test.describe.configure({ mode: 'serial' });

test.describe('scrutiny e2e', () => {
  test.beforeAll(async () => {
    if (!DATABASE_URL) {
      throw new Error('DATABASE_URL or E2E_DATABASE_URL is required for scrutiny E2E tests.');
    }

    pool = new Pool({ connectionString: DATABASE_URL });
    adminUser = await loadAdminUser();
    voterUser = await loadVoterUser();
    adminToken = createSessionToken(adminUser);
    voterToken = createSessionToken(voterUser);
  });

  test.beforeEach(async () => {
    await resetScrutinyFixture();
  });

  test.afterAll(async () => {
    if (pool) {
      await cleanupScrutinyFixture();
      await pool.end();
    }
  });

  test('backend protects scrutiny endpoints from anonymous and non-admin users', async ({ request }) => {
    const anonymous = await request.get(`${BACKEND_URL}/api/scrutiny/${electionId}`);
    const anonymousBody = await anonymous.json();

    expect(anonymous.status()).toBe(401);
    expect(anonymousBody).toEqual(expect.objectContaining({ error: expect.any(String) }));

    const voter = await request.get(`${BACKEND_URL}/api/scrutiny/${electionId}`, {
      headers: authHeaders(voterToken),
    });
    const voterBody = await voter.json();

    expect(voter.status()).toBe(403);
    expect(voterBody).toEqual(expect.objectContaining({ error: expect.any(String) }));
  });

  test('admin API reports scrutiny progress and blocks results before finalization', async ({ request }) => {
    const progress = await request.get(`${BACKEND_URL}/api/scrutiny/${electionId}`, {
      headers: authHeaders(adminToken),
    });
    const progressBody = (await progress.json()) as ScrutinyResponse;

    expect(progress.status()).toBe(200);
    expect(progressBody).toEqual(
      expect.objectContaining({
        electionInfo: expect.objectContaining({
          id: electionId,
          title: electionFixture.title,
          status: 'CLOSED',
          requires_keys: true,
          min_keys: 1,
        }),
        progressScrutiny: expect.objectContaining({
          total_Members: 0,
          submittedKeys: 0,
          membersPending: [],
          can_finalize: false,
        }),
        general_Metric: expect.objectContaining({
          total_votes: 1,
          total_elegibles: 2,
          participation_rate: 50,
        }),
        publication_status: 'results_available',
      })
    );

    const results = await request.get(`${BACKEND_URL}/api/scrutiny/${electionId}/results`, {
      headers: authHeaders(adminToken),
    });
    const resultsBody = await results.json();

    expect(results.status()).toBe(409);
    expect(resultsBody).toEqual(expect.objectContaining({ code: 'SCRUTINY_RESULTS_NOT_FINALIZED' }));
  });

  test('admin API assigns, validates, submits keys and exposes finalized results', async ({ request }) => {
    const duplicateMembers = await request.post(`${BACKEND_URL}/api/scrutiny/${electionId}/assign-members`, {
      headers: authHeaders(adminToken),
      data: {
        option: '1',
        students_id: [adminUser.studentId, adminUser.studentId],
      },
    });
    const duplicateMembersBody = await duplicateMembers.json();

    expect(duplicateMembers.status()).toBe(400);
    expect(duplicateMembersBody).toEqual(
      expect.objectContaining({ code: 'SCRUTINY_DUPLICATE_STUDENT_IDS' })
    );

    const key = await assignAdminKey(request);

    const assignedProgress = await request.get(`${BACKEND_URL}/api/scrutiny/${electionId}`, {
      headers: authHeaders(adminToken),
    });
    const assignedProgressBody = (await assignedProgress.json()) as ScrutinyResponse;

    expect(assignedProgress.status()).toBe(200);
    expect(assignedProgressBody.progressScrutiny).toEqual(
      expect.objectContaining({
        total_Members: 1,
        submittedKeys: 0,
        can_finalize: false,
      })
    );
    expect(assignedProgressBody.progressScrutiny.membersPending[0]).toEqual(
      expect.objectContaining({
        id: adminUser.studentId,
        carnet: adminUser.carnet,
        has_submitted: false,
      })
    );

    const invalidKey = await request.post(`${BACKEND_URL}/api/scrutiny/${electionId}/submit-key`, {
      headers: authHeaders(adminToken),
      data: {
        key: 'E2E_WRONG_KEY',
      },
    });
    const invalidKeyBody = await invalidKey.json();

    expect(invalidKey.status()).toBe(403);
    expect(invalidKeyBody).toEqual(expect.objectContaining({ code: 'SCRUTINY_KEY_INVALID' }));

    const submitted = await request.post(`${BACKEND_URL}/api/scrutiny/${electionId}/submit-key`, {
      headers: authHeaders(adminToken),
      data: {
        key,
      },
    });
    const submittedBody = (await submitted.json()) as SubmitKeyResponse;

    expect(submitted.status()).toBe(201);
    expect(submittedBody).toEqual(
      expect.objectContaining({
        submitted: true,
        finalized: true,
      })
    );

    const finalizedProgress = await request.get(`${BACKEND_URL}/api/scrutiny/${electionId}`, {
      headers: authHeaders(adminToken),
    });
    const finalizedProgressBody = (await finalizedProgress.json()) as ScrutinyResponse;

    expect(finalizedProgress.status()).toBe(200);
    expect(finalizedProgressBody.electionInfo.status).toBe('SCRUTINIZED');
    expect(finalizedProgressBody.progressScrutiny).toEqual(
      expect.objectContaining({
        total_Members: 1,
        submittedKeys: 1,
        can_finalize: true,
      })
    );
    expect(finalizedProgressBody.publication_status).toBe('finalized_at');

    const results = await request.get(`${BACKEND_URL}/api/scrutiny/${electionId}/results`, {
      headers: authHeaders(adminToken),
    });
    const resultsBody = (await results.json()) as ScrutinyResultsResponse;

    expect(results.status()).toBe(201);
    expect(resultsBody).toEqual(
      expect.objectContaining({
        id: electionId,
        title: electionFixture.title,
        total_votes: 1,
        total_elegibles: 2,
        participation_rate: 50,
        options: expect.any(Array),
      })
    );
    expect(resultsBody.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: electionFixture.options[0],
          vote_count: 1,
          percentage: 100,
        }),
        expect.objectContaining({
          label: electionFixture.options[1],
          vote_count: 0,
          percentage: 0,
        }),
      ])
    );
  });

  test('admin UI lists pending scrutiny and submits the assigned key', async ({ page, request }) => {
    const key = await assignAdminKey(request);

    await seedStoredSession(page, adminUser);

    const electionsResponse = page.waitForResponse(
      (response) =>
        response.url() === `${BACKEND_URL}/api/elections` && response.status() === 200
    );

    await page.goto(`${FRONTEND_URL}/escrutinio`);
    await electionsResponse;

    await expect(page).toHaveURL(/\/escrutinio$/);
    await expect(page.getByRole('heading', { name: /^Escrutinio$/i })).toBeVisible();
    await expect(page.getByRole('cell', { name: electionFixture.title })).toBeVisible();
    await expect(page.getByRole('link', { name: /Canjear llave/i })).toBeVisible();

    const scrutinyResponse = page.waitForResponse(
      (response) =>
        response.url() === `${BACKEND_URL}/api/scrutiny/${electionId}` && response.status() === 200
    );

    await page.getByRole('link', { name: /Canjear llave/i }).click();
    await scrutinyResponse;

    await expect(page).toHaveURL(new RegExp(`/escrutinio/subir\\?id=${electionId}$`));
    await expect(page.getByRole('heading', { name: /Escrutinio de resultados/i })).toBeVisible();
    await expect(page.getByText(electionFixture.title)).toBeVisible();
    await expect(page.getByText(/0 de 1 requeridas/i)).toBeVisible();
    await expect(page.getByRole('main').getByText(adminUser.fullName)).toBeVisible();

    await page.getByLabel(/Llave de escrutinio/i).fill(key);
    await page.getByRole('button', { name: /^Canjear$/i }).click();

    await expect(page.getByText(/Llave canjeada/i)).toBeVisible();
    await expect(page.getByText(/Finalizada/i).first()).toBeVisible();
  });

  test('voter and anonymous users are redirected away from scrutiny UI', async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/escrutinio`);

    await expect(page).toHaveURL(escapedFrontendUrl());
    await expect(page.getByRole('button', { name: /Continuar con Microsoft/i })).toBeVisible();

    await seedStoredSession(page, voterUser);
    await page.goto(`${FRONTEND_URL}/escrutinio`);

    await expect(page).toHaveURL(/\/votaciones$/);
  });
});
