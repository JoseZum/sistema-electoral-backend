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
type ElectionStatus = 'DRAFT' | 'SCHEDULED' | 'OPEN' | 'CLOSED' | 'SCRUTINIZED' | 'ARCHIVED';
type VoterSource = 'FULL_PADRON' | 'FILTERED' | 'MANUAL' | 'TAG';

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

interface ElectionOption {
  id: string;
  election_id: string;
  label: string;
  option_type: string;
  display_order: number;
  metadata: Record<string, unknown> | null;
}

interface ElectionSummary {
  id: string;
  title: string;
  description: string | null;
  status: ElectionStatus;
  is_anonymous: boolean;
  auth_method: 'MICROSOFT';
  voter_source: VoterSource;
  voter_filter: Record<string, unknown> | null;
  tag_id: string | null;
  starts_immediately: boolean;
  immediate_minutes: number | null;
  requires_keys: boolean;
  min_keys: number;
  start_time: string | null;
  end_time: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  total_voters?: number;
  votes_cast?: number;
  options_count?: number;
}

interface ElectionDetail extends ElectionSummary {
  options: ElectionOption[];
  total_voters: number;
  votes_cast: number;
  options_count: number;
}

interface ElectionResults {
  election: ElectionSummary;
  options: Array<{
    id: string;
    label: string;
    option_type: string;
    vote_count: number;
    percentage: number;
  }>;
  total_votes: number;
  total_eligible: number;
  participation_rate: number;
  voters?: Array<{
    full_name: string;
    carnet: string;
  }>;
}

const electionPrefix = 'E2E Elections';
const electionFixture = {
  title: `${electionPrefix} Base`,
  updatedTitle: `${electionPrefix} Actualizada`,
  uiTitle: `${electionPrefix} UI Principal`,
  description: 'Eleccion deterministica para pruebas E2E de elecciones',
  updatedDescription: 'Eleccion actualizada por pruebas E2E',
  optionA: `${electionPrefix} Opcion A`,
  optionB: `${electionPrefix} Opcion B`,
  optionC: `${electionPrefix} Opcion C`,
};

let pool: Pool;
let adminUser: E2EUser;
let voterUser: E2EUser;
let adminToken: string;
let voterToken: string;

function baseUrl(url: string): string {
  return url.replace(/\/$/, '');
}

function apiUrl(path: string): string {
  return `${baseUrl(BACKEND_URL)}${path}`;
}

function frontendUrl(path: string): string {
  return `${baseUrl(FRONTEND_URL)}${path}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function frontendRootRegex(): RegExp {
  return new RegExp(`${escapeRegExp(baseUrl(FRONTEND_URL))}/?$`);
}

function futureIso(hoursFromNow: number): string {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
}

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

async function cleanupElectionAuditLogs(
  client: PoolClient | Pool,
  electionIds: string[] = []
): Promise<void> {
  await client.query(
    `DELETE FROM audit_logs
     WHERE resource_id = ANY($1::text[])
        OR details::text LIKE $2`,
    [electionIds, `%${electionPrefix}%`]
  );
}

async function cleanupElectionsFixture(client: PoolClient | Pool = pool): Promise<void> {
  const electionIds = await client.query<{ id: string }>(
    'SELECT id FROM elections WHERE title LIKE $1',
    [`${electionPrefix}%`]
  );
  const ids = electionIds.rows.map((row) => row.id);

  await cleanupElectionAuditLogs(client, ids);

  if (ids.length > 0) {
    await client.query('DELETE FROM scrutiny_keys WHERE election_id = ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM voting_tokens WHERE election_id = ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM votes WHERE election_id = ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM election_voters WHERE election_id = ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM election_options WHERE election_id = ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM elections WHERE id = ANY($1::uuid[])', [ids]);
  }

  await cleanupElectionAuditLogs(client, ids);
}

function buildElectionPayload(
  overrides: Partial<{
    title: string;
    description: string | null;
    status: ElectionStatus | 'AUTO';
    is_anonymous: boolean;
    voter_source: VoterSource;
    starts_immediately: boolean;
    immediate_minutes: number | null;
    requires_keys: boolean;
    min_keys: number | null;
    start_time: string | null;
    end_time: string | null;
    options: Array<{
      label: string;
      description?: string;
      option_type: string;
      display_order?: number;
    }>;
    populate: {
      student_ids?: string[];
      sede?: string;
      career?: string;
      tag_id?: string;
    };
  }> = {}
) {
  return {
    title: overrides.title || electionFixture.title,
    description: overrides.description ?? electionFixture.description,
    status: overrides.status || 'DRAFT',
    is_anonymous: overrides.is_anonymous ?? false,
    voter_source: overrides.voter_source || 'MANUAL',
    starts_immediately: overrides.starts_immediately ?? false,
    immediate_minutes: overrides.immediate_minutes ?? null,
    requires_keys: overrides.requires_keys ?? false,
    min_keys: overrides.min_keys ?? 1,
    start_time: overrides.start_time ?? futureIso(24),
    end_time: overrides.end_time ?? futureIso(25),
    options:
      overrides.options ??
      [
        {
          label: electionFixture.optionA,
          option_type: 'CANDIDATE',
          display_order: 1,
        },
        {
          label: electionFixture.optionB,
          option_type: 'CANDIDATE',
          display_order: 2,
        },
      ],
    populate:
      overrides.populate ??
      {
        student_ids: [adminUser.studentId, voterUser.studentId],
      },
  };
}

async function createElectionThroughApi(
  request: APIRequestContext,
  overrides: Parameters<typeof buildElectionPayload>[0] = {}
): Promise<ElectionSummary> {
  const response = await request.post(apiUrl('/api/elections'), {
    headers: authHeaders(adminToken),
    data: buildElectionPayload(overrides),
  });
  const body = (await response.json()) as ElectionSummary;

  expect(response.status()).toBe(201);
  return body;
}

async function findElectionByTitle(
  request: APIRequestContext,
  title: string
): Promise<ElectionSummary | undefined> {
  const response = await request.get(apiUrl('/api/elections'), {
    headers: authHeaders(adminToken),
  });
  const body = (await response.json()) as ElectionSummary[];

  expect(response.status()).toBe(200);
  return body.find((election) => election.title === title);
}

test.describe.configure({ mode: 'serial' });

test.describe('elections e2e', () => {
  test.beforeAll(async () => {
    if (!DATABASE_URL) {
      throw new Error('DATABASE_URL or E2E_DATABASE_URL is required for elections E2E tests.');
    }

    pool = new Pool({ connectionString: DATABASE_URL });
    adminUser = await loadAdminUser();
    voterUser = await loadVoterUser();
    adminToken = createSessionToken(adminUser);
    voterToken = createSessionToken(voterUser);
  });

  test.beforeEach(async () => {
    await cleanupElectionsFixture();
  });

  test.afterAll(async () => {
    if (pool) {
      await cleanupElectionsFixture();
      await pool.end();
    }
  });

  test('backend protects election management endpoints from anonymous and non-admin users', async ({ request }) => {
    const anonymous = await request.get(apiUrl('/api/elections'));
    const anonymousBody = await anonymous.json();

    expect(anonymous.status()).toBe(401);
    expect(anonymousBody).toEqual(expect.objectContaining({ error: expect.any(String) }));

    const voter = await request.get(apiUrl('/api/elections'), {
      headers: authHeaders(voterToken),
    });
    const voterBody = await voter.json();

    expect(voter.status()).toBe(403);
    expect(voterBody).toEqual(expect.objectContaining({ error: expect.any(String) }));

    const voterCreate = await request.post(apiUrl('/api/elections'), {
      headers: authHeaders(voterToken),
      data: buildElectionPayload({ title: `${electionPrefix} Bloqueada` }),
    });
    const voterCreateBody = await voterCreate.json();

    expect(voterCreate.status()).toBe(403);
    expect(voterCreateBody).toEqual(expect.objectContaining({ error: expect.any(String) }));
  });

  test('admin API creates, lists, updates, closes, reads results and deletes an election', async ({ request }) => {
    const created = await createElectionThroughApi(request);

    expect(created).toEqual(
      expect.objectContaining({
        title: electionFixture.title,
        description: electionFixture.description,
        status: 'DRAFT',
        is_anonymous: false,
        voter_source: 'MANUAL',
        requires_keys: false,
        min_keys: 1,
      })
    );

    const listed = await findElectionByTitle(request, electionFixture.title);
    expect(listed).toEqual(
      expect.objectContaining({
        id: created.id,
        title: electionFixture.title,
        total_voters: 2,
        options_count: 2,
      })
    );

    const detail = await request.get(apiUrl(`/api/elections/${created.id}`), {
      headers: authHeaders(adminToken),
    });
    const detailBody = (await detail.json()) as ElectionDetail;

    expect(detail.status()).toBe(200);
    expect(detailBody).toEqual(
      expect.objectContaining({
        id: created.id,
        total_voters: 2,
        votes_cast: 0,
        options_count: 2,
        options: expect.any(Array),
      })
    );
    expect(detailBody.options.map((option) => option.label)).toEqual([
      electionFixture.optionA,
      electionFixture.optionB,
    ]);

    const update = await request.put(apiUrl(`/api/elections/${created.id}`), {
      headers: authHeaders(adminToken),
      data: {
        title: electionFixture.updatedTitle,
        description: electionFixture.updatedDescription,
        is_anonymous: true,
        voter_source: 'MANUAL',
        starts_immediately: false,
        requires_keys: false,
        min_keys: 1,
        start_time: futureIso(48),
        end_time: futureIso(49),
      },
    });
    const updated = (await update.json()) as ElectionSummary;

    expect(update.status()).toBe(200);
    expect(updated).toEqual(
      expect.objectContaining({
        id: created.id,
        title: electionFixture.updatedTitle,
        description: electionFixture.updatedDescription,
        status: 'DRAFT',
        is_anonymous: true,
      })
    );

    const closed = await request.put(apiUrl(`/api/elections/${created.id}/status`), {
      headers: authHeaders(adminToken),
      data: {
        status: 'CLOSED',
      },
    });
    const closedBody = (await closed.json()) as ElectionSummary;

    expect(closed.status()).toBe(200);
    expect(closedBody).toEqual(expect.objectContaining({ id: created.id, status: 'CLOSED' }));

    const lockedUpdate = await request.put(apiUrl(`/api/elections/${created.id}`), {
      headers: authHeaders(adminToken),
      data: {
        title: `${electionPrefix} No Editable`,
      },
    });
    const lockedUpdateBody = await lockedUpdate.json();

    expect(lockedUpdate.status()).toBe(409);
    expect(lockedUpdateBody).toEqual(expect.objectContaining({ code: 'ELECTION_NOT_EDITABLE' }));

    const results = await request.get(apiUrl(`/api/elections/${created.id}/results`), {
      headers: authHeaders(adminToken),
    });
    const resultsBody = (await results.json()) as ElectionResults;

    expect(results.status()).toBe(200);
    expect(resultsBody).toEqual(
      expect.objectContaining({
        total_votes: 0,
        total_eligible: 2,
        participation_rate: 0,
        options: expect.any(Array),
      })
    );
    expect(resultsBody.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: electionFixture.optionA, vote_count: 0, percentage: 0 }),
        expect.objectContaining({ label: electionFixture.optionB, vote_count: 0, percentage: 0 }),
      ])
    );

    const deleted = await request.delete(apiUrl(`/api/elections/${created.id}`), {
      headers: authHeaders(adminToken),
    });
    const deletedBody = await deleted.json();

    expect(deleted.status()).toBe(200);
    expect(deletedBody).toEqual(expect.objectContaining({ success: true }));

    const missing = await request.get(apiUrl(`/api/elections/${created.id}`), {
      headers: authHeaders(adminToken),
    });
    const missingBody = await missing.json();

    expect(missing.status()).toBe(404);
    expect(missingBody).toEqual(expect.objectContaining({ code: 'ELECTION_NOT_FOUND' }));
  });

  test('admin API manages draft options and voters through dedicated endpoints', async ({ request }) => {
    const created = await createElectionThroughApi(request, {
      title: `${electionPrefix} Opciones y Votantes`,
      options: [],
      populate: {
        student_ids: [],
      },
    });

    const addOption = await request.post(apiUrl(`/api/elections/${created.id}/options`), {
      headers: authHeaders(adminToken),
      data: {
        label: electionFixture.optionA,
        description: 'Opcion creada desde endpoint dedicado',
        option_type: 'CANDIDATE',
        display_order: 1,
      },
    });
    const option = (await addOption.json()) as ElectionOption;

    expect(addOption.status()).toBe(201);
    expect(option).toEqual(
      expect.objectContaining({
        election_id: created.id,
        label: electionFixture.optionA,
        option_type: 'CANDIDATE',
        display_order: 1,
      })
    );

    const updateOption = await request.put(apiUrl(`/api/elections/${created.id}/options/${option.id}`), {
      headers: authHeaders(adminToken),
      data: {
        label: electionFixture.optionC,
        description: 'Descripcion actualizada desde E2E',
        display_order: 2,
      },
    });
    const updatedOption = (await updateOption.json()) as ElectionOption;

    expect(updateOption.status()).toBe(200);
    expect(updatedOption).toEqual(
      expect.objectContaining({
        id: option.id,
        label: electionFixture.optionC,
        display_order: 2,
        metadata: expect.objectContaining({
          description: 'Descripcion actualizada desde E2E',
        }),
      })
    );

    const populate = await request.post(apiUrl(`/api/elections/${created.id}/voters/populate`), {
      headers: authHeaders(adminToken),
      data: {
        student_ids: [adminUser.studentId, voterUser.studentId],
      },
    });
    const populateBody = await populate.json();

    expect(populate.status()).toBe(200);
    expect(populateBody).toEqual(
      expect.objectContaining({
        added: 2,
        total: 2,
      })
    );

    const populatedDetail = await request.get(apiUrl(`/api/elections/${created.id}`), {
      headers: authHeaders(adminToken),
    });
    const populatedDetailBody = (await populatedDetail.json()) as ElectionDetail;

    expect(populatedDetail.status()).toBe(200);
    expect(populatedDetailBody.total_voters).toBe(2);
    expect(populatedDetailBody.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: option.id,
          label: electionFixture.optionC,
        }),
      ])
    );

    const clearVoters = await request.delete(apiUrl(`/api/elections/${created.id}/voters`), {
      headers: authHeaders(adminToken),
    });
    const clearVotersBody = await clearVoters.json();

    expect(clearVoters.status()).toBe(200);
    expect(clearVotersBody).toEqual(expect.objectContaining({ success: true }));

    const deleteOption = await request.delete(apiUrl(`/api/elections/${created.id}/options/${option.id}`), {
      headers: authHeaders(adminToken),
    });
    const deleteOptionBody = await deleteOption.json();

    expect(deleteOption.status()).toBe(200);
    expect(deleteOptionBody).toEqual(expect.objectContaining({ success: true }));

    const finalDetail = await request.get(apiUrl(`/api/elections/${created.id}`), {
      headers: authHeaders(adminToken),
    });
    const finalDetailBody = (await finalDetail.json()) as ElectionDetail;

    expect(finalDetail.status()).toBe(200);
    expect(finalDetailBody.total_voters).toBe(0);
    expect(finalDetailBody.options).toHaveLength(0);
  });

  test('admin API validates election schedule, options and publication requirements', async ({ request }) => {
    const invalidSchedule = await request.post(apiUrl('/api/elections'), {
      headers: authHeaders(adminToken),
      data: buildElectionPayload({
        title: `${electionPrefix} Fechas Invalidas`,
        start_time: futureIso(3),
        end_time: futureIso(2),
      }),
    });
    const invalidScheduleBody = await invalidSchedule.json();

    expect(invalidSchedule.status()).toBe(400);
    expect(invalidScheduleBody).toEqual(
      expect.objectContaining({
        code: 'ELECTION_INVALID_END_BEFORE_START',
      })
    );

    const duplicateOptions = await request.post(apiUrl('/api/elections'), {
      headers: authHeaders(adminToken),
      data: buildElectionPayload({
        title: `${electionPrefix} Opciones Duplicadas`,
        options: [
          {
            label: 'Plan Repetido',
            option_type: 'CANDIDATE',
            display_order: 1,
          },
          {
            label: '  plan repetido  ',
            option_type: 'CANDIDATE',
            display_order: 2,
          },
        ],
      }),
    });
    const duplicateOptionsBody = await duplicateOptions.json();

    expect(duplicateOptions.status()).toBe(400);
    expect(duplicateOptionsBody).toEqual(
      expect.objectContaining({
        code: 'ELECTION_OPTIONS_DUPLICATE',
      })
    );

    const noOptionsForPublication = await request.post(apiUrl('/api/elections'), {
      headers: authHeaders(adminToken),
      data: buildElectionPayload({
        title: `${electionPrefix} Sin Opciones`,
        status: 'OPEN',
        options: [],
      }),
    });
    const noOptionsForPublicationBody = await noOptionsForPublication.json();

    expect(noOptionsForPublication.status()).toBe(400);
    expect(noOptionsForPublicationBody).toEqual(
      expect.objectContaining({
        code: 'ELECTION_OPTIONS_REQUIRED_FOR_PUBLICATION',
      })
    );
  });

  test('admin UI lists elections and deletes a draft election from the main page', async ({ page, request }) => {
    const created = await createElectionThroughApi(request, {
      title: electionFixture.uiTitle,
    });

    await seedStoredSession(page, adminUser);

    const electionsResponse = page.waitForResponse(
      (response) => response.url() === apiUrl('/api/elections') && response.status() === 200
    );

    await page.goto(frontendUrl('/elecciones'));
    await electionsResponse;

    await expect(page).toHaveURL(/\/elecciones$/);
    await expect(page.getByRole('heading', { name: /Votaciones/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Nueva votaci/i })).toBeVisible();

    const row = page.getByRole('row').filter({ hasText: electionFixture.uiTitle });
    await expect(row).toBeVisible();
    await expect(row.getByText(/Borrador/i)).toBeVisible();
    await expect(row.locator('td').nth(3)).toHaveText('2');

    page.once('dialog', async (dialog) => {
      await dialog.accept();
    });

    const deleteResponse = page.waitForResponse(
      (response) =>
        response.url() === apiUrl(`/api/elections/${created.id}`) &&
        response.request().method() === 'DELETE' &&
        response.status() === 200
    );

    await row.getByRole('button', { name: /Eliminar votaci/i }).click();
    await deleteResponse;

    await expect(row).toHaveCount(0);
    expect(await findElectionByTitle(request, electionFixture.uiTitle)).toBeUndefined();
  });

  test('voter and anonymous users are redirected away from elections UI', async ({ page }) => {
    await page.goto(frontendUrl('/elecciones'));

    await expect(page).toHaveURL(frontendRootRegex());
    await expect(page.getByRole('button', { name: /Continuar con Microsoft/i })).toBeVisible();

    await seedStoredSession(page, voterUser);
    await page.goto(frontendUrl('/elecciones'));

    await expect(page).toHaveURL(/\/votaciones$/);
  });
});
