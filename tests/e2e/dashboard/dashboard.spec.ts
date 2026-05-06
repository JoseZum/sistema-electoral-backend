import { expect, test, type Page } from '@playwright/test';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';

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

interface OngoingElection {
  id: string;
  title: string;
  startTime: string | null;
  endTime: string | null;
  votesCount: number;
  totalVoters: number;
  progressPercentage: number;
}

interface DashboardStats {
  totalStudents: number;
  activeStudents: number;
  totalElections: number;
  openElections: number;
  totalVotes: number;
  participation: number;
  ongoingElections: OngoingElection[];
}

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

async function loadExpectedDashboardStats(): Promise<DashboardStats> {
  const counts = await pool.query<{
    total_students: string;
    active_students: string;
    total_elections: string;
    open_elections: string;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM students) AS total_students,
       (SELECT COUNT(*) FROM students WHERE is_active = true) AS active_students,
       (SELECT COUNT(*) FROM elections) AS total_elections,
       (SELECT COUNT(*) FROM elections WHERE status = 'OPEN') AS open_elections`
  );

  const voteTotals = await pool.query<{ total_votes: string; total_voters: string }>(
    `SELECT
       COALESCE(SUM(votes_cast), 0) AS total_votes,
       COALESCE(SUM(total_voters), 0) AS total_voters
     FROM (
       SELECT election_id,
         COUNT(*) AS total_voters,
         COUNT(*) FILTER (WHERE token_used = true) AS votes_cast
       FROM election_voters
       GROUP BY election_id
     ) ev`
  );

  const ongoing = await pool.query<{
    id: string;
    title: string;
    start_time: Date | null;
    end_time: Date | null;
    votes_cast: number;
    total_voters: number;
    progress_percentage: string | number;
  }>(
    `SELECT
       e.id,
       e.title,
       e.start_time,
       e.end_time,
       COALESCE(ev.votes_cast, 0)::int AS votes_cast,
       COALESCE(ev.total_voters, 0)::int AS total_voters,
       CASE
         WHEN COALESCE(ev.total_voters, 0) > 0 THEN
           ROUND((COALESCE(ev.votes_cast, 0)::numeric / ev.total_voters::numeric) * 100, 1)
         ELSE 0
       END AS progress_percentage
     FROM elections e
     LEFT JOIN (
       SELECT election_id,
         COUNT(*) AS total_voters,
         COUNT(*) FILTER (WHERE token_used = true) AS votes_cast
       FROM election_voters
       GROUP BY election_id
     ) ev ON ev.election_id = e.id
     WHERE e.status = 'OPEN'
     ORDER BY e.end_time ASC NULLS LAST, e.start_time ASC NULLS LAST`
  );

  const totalVotes = Number(voteTotals.rows[0].total_votes);
  const totalVoters = Number(voteTotals.rows[0].total_voters);

  return {
    totalStudents: Number(counts.rows[0].total_students),
    activeStudents: Number(counts.rows[0].active_students),
    totalElections: Number(counts.rows[0].total_elections),
    openElections: Number(counts.rows[0].open_elections),
    totalVotes,
    participation: totalVoters > 0 ? Number(((totalVotes / totalVoters) * 100).toFixed(1)) : 0,
    ongoingElections: ongoing.rows.map((row) => ({
      id: row.id,
      title: row.title,
      startTime: row.start_time ? row.start_time.toISOString() : null,
      endTime: row.end_time ? row.end_time.toISOString() : null,
      votesCount: Number(row.votes_cast),
      totalVoters: Number(row.total_voters),
      progressPercentage: Number(row.progress_percentage),
    })),
  };
}

test.describe.configure({ mode: 'serial' });

test.describe('dashboard e2e', () => {
  test.beforeAll(async () => {
    if (!DATABASE_URL) {
      throw new Error('DATABASE_URL or E2E_DATABASE_URL is required for dashboard E2E tests.');
    }

    pool = new Pool({ connectionString: DATABASE_URL });
    adminUser = await loadAdminUser();
    voterUser = await loadVoterUser();
    adminToken = createSessionToken(adminUser);
    voterToken = createSessionToken(voterUser);
  });

  test.afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  test('backend protects dashboard stats from anonymous and non-admin users', async ({ request }) => {
    const anonymous = await request.get(`${BACKEND_URL}/api/dashboard/stats`);
    const anonymousBody = await anonymous.json();

    expect(anonymous.status()).toBe(401);
    expect(anonymousBody).toEqual(expect.objectContaining({ error: expect.any(String) }));

    const voter = await request.get(`${BACKEND_URL}/api/dashboard/stats`, {
      headers: authHeaders(voterToken),
    });
    const voterBody = await voter.json();

    expect(voter.status()).toBe(403);
    expect(voterBody).toEqual(expect.objectContaining({ error: expect.any(String) }));
  });

  test('admin API returns the dashboard stats contract backed by the database', async ({ request }) => {
    const expectedStats = await loadExpectedDashboardStats();
    const response = await request.get(`${BACKEND_URL}/api/dashboard/stats`, {
      headers: authHeaders(adminToken),
    });
    const body = (await response.json()) as DashboardStats;

    expect(response.status()).toBe(200);
    expect(body).toEqual(expectedStats);
    expect(body).toEqual(
      expect.objectContaining({
        totalStudents: expect.any(Number),
        activeStudents: expect.any(Number),
        totalElections: expect.any(Number),
        openElections: expect.any(Number),
        totalVotes: expect.any(Number),
        participation: expect.any(Number),
        ongoingElections: expect.any(Array),
      })
    );

    for (const election of body.ongoingElections) {
      expect(election).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          title: expect.any(String),
          votesCount: expect.any(Number),
          totalVoters: expect.any(Number),
          progressPercentage: expect.any(Number),
        })
      );
    }
  });

  test('admin UI opens dashboard and renders stats from the backend', async ({ page }) => {
    await seedStoredSession(page, adminUser);

    const statsResponse = page.waitForResponse(
      (response) =>
        response.url() === `${BACKEND_URL}/api/dashboard/stats` && response.status() === 200
    );

    await page.goto(`${FRONTEND_URL}/dashboard`);
    const response = await statsResponse;
    const stats = (await response.json()) as DashboardStats;

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText(/Dashboard/i).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: /Buenos d.as|Buenas tardes|Buenas noches/i })).toBeVisible();
    await expect(page.getByText(/Elecciones activas/i)).toBeVisible();
    await expect(page.getByText(/Total de elecciones/i)).toBeVisible();
    await expect(page.getByText(/Votos emitidos/i)).toBeVisible();
    await expect(page.getByText(/Estudiantes activos/i)).toBeVisible();
    await expect(page.getByRole('heading', { name: /Elecciones en curso/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Actividad reciente/i })).toBeVisible();
    await expect(page.getByText(String(stats.openElections)).first()).toBeVisible();
    await expect(page.getByText(`${stats.participation.toFixed(1)}%`).first()).toBeVisible();
  });

  test('voter and anonymous users are redirected away from dashboard UI', async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/dashboard`);

    await expect(page).toHaveURL(new RegExp(`${FRONTEND_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?$`));
    await expect(page.getByRole('button', { name: /Continuar con Microsoft/i })).toBeVisible();

    await seedStoredSession(page, voterUser);
    await page.goto(`${FRONTEND_URL}/dashboard`);

    await expect(page).toHaveURL(new RegExp(`${FRONTEND_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?$`));
    await expect(page.getByRole('button', { name: /Continuar con Microsoft/i })).toBeVisible();
  });
});
