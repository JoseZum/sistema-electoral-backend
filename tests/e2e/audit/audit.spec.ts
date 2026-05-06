import { expect, test, type Page } from '@playwright/test';
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

interface AuditLog {
  id: string;
  actor_id: string | null;
  actor_carnet: string | null;
  actor_name?: string | null;
  action: string;
  actionLabel: string;
  resource_type: string;
  resourceLabel: string;
  resource_id: string | null;
  details: Record<string, unknown> | null;
  activityMessage: string;
  created_at: string;
}

interface AuditResponse {
  logs: AuditLog[];
  total: number;
  page: number;
  limit: number;
}

interface AuditStatRow {
  resource_type: string;
  count: string | number;
  last_activity: string | null;
}

interface ActiveDay {
  date: string;
  count: number;
}

interface AuditExportResponse {
  exported_at: string;
  count: number;
  truncated: boolean;
  logs: AuditLog[];
}

const auditMarker = 'E2E_AUDIT_TRACE';
const auditActions = {
  student: 'E2E.audit.student',
  tag: 'E2E.audit.tag',
  privateVote: 'E2E.audit.private_vote',
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

async function cleanupAuditFixture(client: PoolClient | Pool = pool): Promise<void> {
  await client.query(
    `DELETE FROM audit_logs
     WHERE action LIKE 'E2E.%'
        OR resource_id LIKE 'E2E_AUDIT_%'
        OR details::text LIKE $1`,
    [`%${auditMarker}%`]
  );
}

async function resetAuditFixture(): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await cleanupAuditFixture(client);
    await client.query(
      `INSERT INTO audit_logs
        (actor_id, actor_carnet, action, resource_type, resource_id, details, ip_address, created_at)
       VALUES
        ($1, $2, $3, 'student', 'E2E_AUDIT_STUDENT_001', $4::jsonb, '127.0.0.1', now() - interval '2 seconds'),
        ($1, $2, $5, 'tag', 'E2E_AUDIT_TAG_001', $6::jsonb, '127.0.0.1', now() - interval '1 second'),
        ($1, $2, $7, 'vote', 'E2E_AUDIT_PRIVATE_001', $8::jsonb, '127.0.0.1', now())`,
      [
        adminUser.studentId,
        adminUser.carnet,
        auditActions.student,
        JSON.stringify({
          marker: auditMarker,
          target_name: 'E2E Audit Persona',
          target_carnet: '2099999201',
          changes: { full_name: 'E2E Audit Persona Actualizada' },
          previous: { full_name: 'E2E Audit Persona' },
        }),
        auditActions.tag,
        JSON.stringify({
          marker: auditMarker,
          tag_name: 'E2E Audit Tag',
          new: { name: 'E2E Audit Tag', member_count: 1 },
        }),
        auditActions.privateVote,
        JSON.stringify({
          marker: auditMarker,
          note: 'This private resource type must never be exposed by audit endpoints.',
        }),
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

test.describe.configure({ mode: 'serial' });

test.describe('audit e2e', () => {
  test.beforeAll(async () => {
    if (!DATABASE_URL) {
      throw new Error('DATABASE_URL or E2E_DATABASE_URL is required for audit E2E tests.');
    }

    pool = new Pool({ connectionString: DATABASE_URL });
    adminUser = await loadAdminUser();
    voterUser = await loadVoterUser();
    adminToken = createSessionToken(adminUser);
    voterToken = createSessionToken(voterUser);
  });

  test.beforeEach(async () => {
    await resetAuditFixture();
  });

  test.afterAll(async () => {
    if (pool) {
      await cleanupAuditFixture();
      await pool.end();
    }
  });

  test('backend protects audit export and purge from anonymous and non-admin users', async ({ request }) => {
    const anonymousExport = await request.get(`${BACKEND_URL}/api/audit/export?format=json`);
    const anonymousExportBody = await anonymousExport.json();

    expect(anonymousExport.status()).toBe(401);
    expect(anonymousExportBody).toEqual(expect.objectContaining({ error: expect.any(String) }));

    const voterExport = await request.get(`${BACKEND_URL}/api/audit/export?format=json`, {
      headers: authHeaders(voterToken),
    });
    const voterExportBody = await voterExport.json();

    expect(voterExport.status()).toBe(403);
    expect(voterExportBody).toEqual(expect.objectContaining({ error: expect.any(String) }));

    const anonymousPurge = await request.delete(`${BACKEND_URL}/api/audit`, {
      data: { action: 'E2E.audit.%' },
    });
    const anonymousPurgeBody = await anonymousPurge.json();

    expect(anonymousPurge.status()).toBe(401);
    expect(anonymousPurgeBody).toEqual(expect.objectContaining({ error: expect.any(String) }));

    const voterPurge = await request.delete(`${BACKEND_URL}/api/audit`, {
      headers: authHeaders(voterToken),
      data: { action: 'E2E.audit.%' },
    });
    const voterPurgeBody = await voterPurge.json();

    expect(voterPurge.status()).toBe(403);
    expect(voterPurgeBody).toEqual(expect.objectContaining({ error: expect.any(String) }));
  });

  test('admin API lists, filters, enriches and hides private audit resources', async ({ request }) => {
    const listed = await request.get(
      `${BACKEND_URL}/api/audit?search=${auditMarker}&resource_types=student,tag,vote&limit=10`
    );
    const listedBody = (await listed.json()) as AuditResponse;

    expect(listed.status()).toBe(200);
    expect(listedBody).toEqual(
      expect.objectContaining({
        page: 1,
        limit: 10,
        total: 2,
        logs: expect.any(Array),
      })
    );
    expect(listedBody.logs.map((log) => log.action).sort()).toEqual([
      auditActions.student,
      auditActions.tag,
    ]);
    expect(listedBody.logs.some((log) => log.resource_type === 'vote')).toBe(false);

    for (const log of listedBody.logs) {
      expect(log).toEqual(
        expect.objectContaining({
          actor_carnet: adminUser.carnet,
          actor_name: adminUser.fullName,
          actionLabel: expect.any(String),
          resourceLabel: expect.any(String),
          activityMessage: expect.any(String),
          created_at: expect.any(String),
        })
      );
    }

    const stats = await request.get(`${BACKEND_URL}/api/audit/stats`);
    const statsBody = (await stats.json()) as AuditStatRow[];
    const activeDays = await request.get(`${BACKEND_URL}/api/audit/active-days`);
    const activeDaysBody = (await activeDays.json()) as ActiveDay[];

    expect(stats.status()).toBe(200);
    expect(statsBody.some((row) => row.resource_type === 'vote')).toBe(false);
    expect(statsBody.find((row) => row.resource_type === 'student')).toEqual(
      expect.objectContaining({ count: expect.anything(), last_activity: expect.any(String) })
    );
    expect(activeDays.status()).toBe(200);
    expect(activeDaysBody[0]).toEqual(
      expect.objectContaining({ date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), count: expect.any(Number) })
    );
  });

  test('admin API exports filtered audit logs as JSON and validates purge safeguards', async ({ request }) => {
    const exported = await request.get(
      `${BACKEND_URL}/api/audit/export?format=json&resource_types=student,tag,vote&search=${auditMarker}`,
      {
        headers: authHeaders(adminToken),
      }
    );
    const exportedBody = (await exported.json()) as AuditExportResponse;

    expect(exported.status()).toBe(200);
    expect(exported.headers()['content-disposition']).toMatch(/auditoria_.*\.json/);
    expect(exported.headers()['x-audit-export-count']).toBe('2');
    expect(exportedBody).toEqual(
      expect.objectContaining({
        exported_at: expect.any(String),
        count: 2,
        truncated: false,
        logs: expect.any(Array),
      })
    );
    expect(exportedBody.logs.map((log) => log.action).sort()).toEqual([
      auditActions.student,
      auditActions.tag,
    ]);

    const unsafePurge = await request.delete(`${BACKEND_URL}/api/audit`, {
      headers: authHeaders(adminToken),
      data: {},
    });
    const unsafePurgeBody = await unsafePurge.json();

    expect(unsafePurge.status()).toBe(400);
    expect(unsafePurgeBody).toEqual(expect.objectContaining({ error: expect.any(String) }));
  });

  test('admin UI opens audit timeline and searches deterministic audit events', async ({ page }) => {
    await seedStoredSession(page, adminUser);

    const auditResponse = page.waitForResponse(
      (response) =>
        response.url().startsWith(`${BACKEND_URL}/api/audit?`) && response.status() === 200
    );

    await page.goto(`${FRONTEND_URL}/auditoria`);
    await auditResponse;

    await expect(page).toHaveURL(/\/auditoria$/);
    await expect(page.getByRole('heading', { name: /Registro de actividad/i })).toBeVisible();
    await expect(page.getByRole('navigation', { name: /Filtrar por categor/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Exportar \/ vaciar/i })).toBeVisible();

    await page.getByLabel(/Buscar eventos/i).fill(auditMarker);

    await expect(page.getByText(adminUser.fullName).first()).toBeVisible();
    await expect(page.getByText(/E2e audit student/i).first()).toBeVisible();
    await expect(page.getByText(/E2e audit tag/i).first()).toBeVisible();
    await expect(page.getByText('E2E Audit Tag').first()).toBeVisible();
  });

  test('voter and anonymous users are redirected away from audit UI', async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/auditoria`);

    await expect(page).toHaveURL(new RegExp(`${FRONTEND_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?$`));
    await expect(page.getByRole('button', { name: /Continuar con Microsoft/i })).toBeVisible();

    await seedStoredSession(page, voterUser);
    await page.goto(`${FRONTEND_URL}/auditoria`);

    await expect(page).toHaveURL(/\/votaciones$/);
  });
});
