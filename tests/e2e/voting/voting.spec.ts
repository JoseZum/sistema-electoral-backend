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

interface VoterElection {
  id: string;
  title: string;
  description: string | null;
  status: ElectionStatus;
  is_anonymous: boolean;
  tag_name: string | null;
  tag_color: string | null;
  start_time: string | null;
  end_time: string | null;
  has_voted: boolean;
  total_options: number;
}

interface VoteOption {
  id: string;
  label: string;
  option_type: string;
  display_order: number;
}

interface VoterElectionDetail extends Omit<VoterElection, 'total_options'> {
  options: VoteOption[];
}

interface CastVoteResponse {
  success: boolean;
  message: string;
}

interface PublicResults {
  election_id: string;
  title: string;
  options: Array<{
    label: string;
    option_type: string;
    vote_count: number;
    percentage: number;
  }>;
  total_votes: number;
  participation_rate: number;
}

interface SeededElection {
  id: string;
  title: string;
  optionAId: string;
  optionBId: string;
}

const votingPrefix = 'E2E Voting';
const votingFixture = {
  title: `${votingPrefix} Nominal Abierta`,
  anonymousTitle: `${votingPrefix} Anonima Abierta`,
  closedTitle: `${votingPrefix} Cerrada`,
  uiTitle: `${votingPrefix} UI`,
  description: 'Eleccion deterministica para pruebas E2E de votacion',
  optionA: `${votingPrefix} Opcion A`,
  optionB: `${votingPrefix} Opcion B`,
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

function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
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

async function cleanupVotingAuditLogs(
  client: PoolClient | Pool,
  electionIds: string[] = []
): Promise<void> {
  await client.query(
    `DELETE FROM audit_logs
     WHERE resource_id = ANY($1::text[])
        OR details::text LIKE $2`,
    [electionIds, `%${votingPrefix}%`]
  );
}

async function cleanupVotingFixture(client: PoolClient | Pool = pool): Promise<void> {
  const electionIds = await client.query<{ id: string }>(
    'SELECT id FROM elections WHERE title LIKE $1',
    [`${votingPrefix}%`]
  );
  const ids = electionIds.rows.map((row) => row.id);

  await cleanupVotingAuditLogs(client, ids);

  if (ids.length > 0) {
    await client.query('DELETE FROM scrutiny_keys WHERE election_id = ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM voting_tokens WHERE election_id = ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM votes WHERE election_id = ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM election_voters WHERE election_id = ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM election_options WHERE election_id = ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM elections WHERE id = ANY($1::uuid[])', [ids]);
  }

  await cleanupVotingAuditLogs(client, ids);
}

async function createVotingElection(overrides: Partial<{
  title: string;
  status: ElectionStatus;
  isAnonymous: boolean;
  voterIds: string[];
}> = {}): Promise<SeededElection> {
  const status = overrides.status ?? 'OPEN';
  const startsInPast = status !== 'SCHEDULED';
  const endsInFuture = status === 'OPEN' || status === 'SCHEDULED';
  const startTime = startsInPast ? hoursFromNow(-1) : hoursFromNow(1);
  const endTime = endsInFuture ? hoursFromNow(2) : hoursFromNow(-0.5);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const election = await client.query<{ id: string }>(
      `INSERT INTO elections (
         title, description, status, is_anonymous, auth_method, voter_source,
         starts_immediately, requires_keys, min_keys, start_time, end_time, created_by
       )
       VALUES ($1, $2, $3::election_status, $4, 'MICROSOFT'::auth_method_type, 'MANUAL'::voter_source_type,
         false, false, 1, $5, $6, $7)
       RETURNING id`,
      [
        overrides.title ?? votingFixture.title,
        votingFixture.description,
        status,
        overrides.isAnonymous ?? false,
        startTime,
        endTime,
        adminUser.studentId,
      ]
    );
    const electionId = election.rows[0].id;

    const optionA = await client.query<{ id: string }>(
      `INSERT INTO election_options (election_id, label, option_type, display_order)
       VALUES ($1, $2, 'CANDIDATE', 1)
       RETURNING id`,
      [electionId, votingFixture.optionA]
    );

    const optionB = await client.query<{ id: string }>(
      `INSERT INTO election_options (election_id, label, option_type, display_order)
       VALUES ($1, $2, 'CANDIDATE', 2)
       RETURNING id`,
      [electionId, votingFixture.optionB]
    );

    for (const voterId of overrides.voterIds ?? [voterUser.studentId]) {
      await client.query(
        `INSERT INTO election_voters (election_id, student_id, token_used, token_used_at)
         VALUES ($1, $2, false, NULL)
         ON CONFLICT (election_id, student_id) DO UPDATE
           SET token_used = false, token_used_at = NULL`,
        [electionId, voterId]
      );
    }

    await client.query('COMMIT');

    return {
      id: electionId,
      title: overrides.title ?? votingFixture.title,
      optionAId: optionA.rows[0].id,
      optionBId: optionB.rows[0].id,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function closeElection(electionId: string): Promise<void> {
  await pool.query(
    `UPDATE elections
     SET status = 'CLOSED'::election_status,
         end_time = now() - interval '1 minute'
     WHERE id = $1`,
    [electionId]
  );
}

async function findElectionInVoterList(
  request: APIRequestContext,
  title: string
): Promise<VoterElection | undefined> {
  const response = await request.get(apiUrl('/api/voting/elections'), {
    headers: authHeaders(voterToken),
  });
  const body = (await response.json()) as VoterElection[];

  expect(response.status()).toBe(200);
  return body.find((election) => election.title === title);
}

test.describe.configure({ mode: 'serial' });

test.describe('voting e2e', () => {
  test.beforeAll(async () => {
    if (!DATABASE_URL) {
      throw new Error('DATABASE_URL or E2E_DATABASE_URL is required for voting E2E tests.');
    }

    pool = new Pool({ connectionString: DATABASE_URL });
    adminUser = await loadAdminUser();
    voterUser = await loadVoterUser();
    adminToken = createSessionToken(adminUser);
    voterToken = createSessionToken(voterUser);
  });

  test.beforeEach(async () => {
    await cleanupVotingFixture();
  });

  test.afterAll(async () => {
    if (pool) {
      await cleanupVotingFixture();
      await pool.end();
    }
  });

  test('backend requires authentication, denies non-eligible voters and blocks closed elections', async ({ request }) => {
    const openElection = await createVotingElection({
      title: `${votingPrefix} Acceso Restringido`,
    });
    const closedElection = await createVotingElection({
      title: votingFixture.closedTitle,
      status: 'CLOSED',
    });

    const anonymous = await request.get(apiUrl('/api/voting/elections'));
    const anonymousBody = await anonymous.json();

    expect(anonymous.status()).toBe(401);
    expect(anonymousBody).toEqual(expect.objectContaining({ error: expect.any(String) }));

    const nonEligibleDetail = await request.get(apiUrl(`/api/voting/elections/${openElection.id}`), {
      headers: authHeaders(adminToken),
    });
    const nonEligibleDetailBody = await nonEligibleDetail.json();

    expect(nonEligibleDetail.status()).toBe(403);
    expect(nonEligibleDetailBody).toEqual(
      expect.objectContaining({ code: 'VOTING_ELECTION_ACCESS_DENIED' })
    );

    const nonEligibleCast = await request.post(apiUrl('/api/voting/cast'), {
      headers: authHeaders(adminToken),
      data: {
        electionId: openElection.id,
        optionId: openElection.optionAId,
      },
    });
    const nonEligibleCastBody = await nonEligibleCast.json();

    expect(nonEligibleCast.status()).toBe(403);
    expect(nonEligibleCastBody).toEqual(
      expect.objectContaining({ code: 'VOTING_ELECTION_ACCESS_DENIED' })
    );

    const closedCast = await request.post(apiUrl('/api/voting/cast'), {
      headers: authHeaders(voterToken),
      data: {
        electionId: closedElection.id,
        optionId: closedElection.optionAId,
      },
    });
    const closedCastBody = await closedCast.json();

    expect(closedCast.status()).toBe(409);
    expect(closedCastBody).toEqual(expect.objectContaining({ code: 'VOTING_NOT_OPEN' }));
  });

  test('voter API lists, opens, casts a named vote once and exposes closed results', async ({ request }) => {
    const election = await createVotingElection();

    const listed = await findElectionInVoterList(request, votingFixture.title);
    expect(listed).toEqual(
      expect.objectContaining({
        id: election.id,
        title: votingFixture.title,
        status: 'OPEN',
        has_voted: false,
        total_options: 2,
      })
    );

    const detail = await request.get(apiUrl(`/api/voting/elections/${election.id}`), {
      headers: authHeaders(voterToken),
    });
    const detailBody = (await detail.json()) as VoterElectionDetail;

    expect(detail.status()).toBe(200);
    expect(detailBody).toEqual(
      expect.objectContaining({
        id: election.id,
        title: votingFixture.title,
        status: 'OPEN',
        is_anonymous: false,
        has_voted: false,
      })
    );
    expect(detailBody.options.map((option) => option.label)).toEqual([
      votingFixture.optionA,
      votingFixture.optionB,
    ]);

    const openResults = await request.get(apiUrl(`/api/voting/elections/${election.id}/results`), {
      headers: authHeaders(voterToken),
    });
    const openResultsBody = await openResults.json();

    expect(openResults.status()).toBe(409);
    expect(openResultsBody).toEqual(expect.objectContaining({ code: 'VOTING_RESULTS_UNAVAILABLE' }));

    const cast = await request.post(apiUrl('/api/voting/cast'), {
      headers: authHeaders(voterToken),
      data: {
        electionId: election.id,
        optionId: election.optionAId,
      },
    });
    const castBody = (await cast.json()) as CastVoteResponse;

    expect(cast.status()).toBe(200);
    expect(castBody).toEqual(
      expect.objectContaining({
        success: true,
        message: expect.any(String),
      })
    );

    const storedVote = await pool.query<{ votes: string; token_used: boolean }>(
      `SELECT COUNT(v.id)::text AS votes, ev.token_used
       FROM election_voters ev
       LEFT JOIN votes v ON v.election_id = ev.election_id AND v.student_id = ev.student_id
       WHERE ev.election_id = $1 AND ev.student_id = $2
       GROUP BY ev.token_used`,
      [election.id, voterUser.studentId]
    );

    expect(storedVote.rows[0]).toEqual(
      expect.objectContaining({
        votes: '1',
        token_used: true,
      })
    );

    const duplicate = await request.post(apiUrl('/api/voting/cast'), {
      headers: authHeaders(voterToken),
      data: {
        electionId: election.id,
        optionId: election.optionBId,
      },
    });
    const duplicateBody = await duplicate.json();

    expect(duplicate.status()).toBe(409);
    expect(duplicateBody).toEqual(expect.objectContaining({ code: 'VOTING_ALREADY_VOTED' }));

    await closeElection(election.id);

    const results = await request.get(apiUrl(`/api/voting/elections/${election.id}/results`), {
      headers: authHeaders(voterToken),
    });
    const resultsBody = (await results.json()) as PublicResults;

    expect(results.status()).toBe(200);
    expect(resultsBody).toEqual(
      expect.objectContaining({
        election_id: election.id,
        title: votingFixture.title,
        total_votes: 1,
        participation_rate: 100,
      })
    );
    expect(resultsBody.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: votingFixture.optionA, vote_count: 1, percentage: 100 }),
        expect.objectContaining({ label: votingFixture.optionB, vote_count: 0, percentage: 0 }),
      ])
    );
  });

  test('voter API casts anonymous votes through encrypted tokens and clears sensitive token material', async ({ request }) => {
    const election = await createVotingElection({
      title: votingFixture.anonymousTitle,
      isAnonymous: true,
    });

    const detail = await request.get(apiUrl(`/api/voting/elections/${election.id}`), {
      headers: authHeaders(voterToken),
    });
    const detailBody = (await detail.json()) as VoterElectionDetail;

    expect(detail.status()).toBe(200);
    expect(detailBody).toEqual(
      expect.objectContaining({
        id: election.id,
        title: votingFixture.anonymousTitle,
        is_anonymous: true,
        has_voted: false,
      })
    );

    const preparedToken = await pool.query<{
      used: boolean;
      token_hash: string | null;
      token_encrypted: string | null;
    }>(
      `SELECT used, token_hash, token_encrypted
       FROM voting_tokens
       WHERE election_id = $1 AND student_id = $2`,
      [election.id, voterUser.studentId]
    );

    expect(preparedToken.rows[0]).toEqual(
      expect.objectContaining({
        used: false,
        token_hash: expect.any(String),
        token_encrypted: expect.any(String),
      })
    );

    const cast = await request.post(apiUrl('/api/voting/cast'), {
      headers: authHeaders(voterToken),
      data: {
        electionId: election.id,
        optionId: election.optionBId,
      },
    });
    const castBody = (await cast.json()) as CastVoteResponse;

    expect(cast.status()).toBe(200);
    expect(castBody.success).toBe(true);

    const anonymousVote = await pool.query<{
      votes: string;
      student_votes: string;
      token_votes: string;
      voter_marked: boolean;
      token_used: boolean;
      token_hash: string | null;
      token_encrypted: string | null;
    }>(
      `SELECT
         COUNT(v.id)::text AS votes,
         COUNT(v.id) FILTER (WHERE v.student_id IS NOT NULL)::text AS student_votes,
         COUNT(v.id) FILTER (WHERE v.token_hash IS NOT NULL)::text AS token_votes,
         ev.token_used AS voter_marked,
         vt.used AS token_used,
         vt.token_hash,
         vt.token_encrypted
       FROM election_voters ev
       LEFT JOIN votes v ON v.election_id = ev.election_id
       LEFT JOIN voting_tokens vt ON vt.election_id = ev.election_id AND vt.student_id = ev.student_id
       WHERE ev.election_id = $1 AND ev.student_id = $2
       GROUP BY ev.token_used, vt.used, vt.token_hash, vt.token_encrypted`,
      [election.id, voterUser.studentId]
    );

    expect(anonymousVote.rows[0]).toEqual(
      expect.objectContaining({
        votes: '1',
        student_votes: '0',
        token_votes: '1',
        voter_marked: true,
        token_used: true,
        token_hash: null,
        token_encrypted: null,
      })
    );

    const duplicate = await request.post(apiUrl('/api/voting/cast'), {
      headers: authHeaders(voterToken),
      data: {
        electionId: election.id,
        optionId: election.optionAId,
      },
    });
    const duplicateBody = await duplicate.json();

    expect(duplicate.status()).toBe(409);
    expect(duplicateBody).toEqual(expect.objectContaining({ code: 'VOTING_ALREADY_VOTED' }));
  });

  test('voter UI lists an open election and casts a vote from the booth', async ({ page, request }) => {
    const election = await createVotingElection({
      title: votingFixture.uiTitle,
    });

    await seedStoredSession(page, voterUser);

    const listResponse = page.waitForResponse(
      (response) =>
        response.url() === apiUrl('/api/voting/elections') &&
        response.request().method() === 'GET' &&
        response.status() === 200
    );

    await page.goto(frontendUrl('/votaciones'));
    await listResponse;

    await expect(page).toHaveURL(/\/votaciones$/);
    await expect(page.getByRole('heading', { name: /Tus/i })).toBeVisible();

    const electionCard = page.getByRole('button', {
      name: new RegExp(`Votar en: ${escapeRegExp(votingFixture.uiTitle)}`),
    });
    await expect(electionCard).toBeVisible();
    await expect(electionCard.getByText(votingFixture.uiTitle)).toBeVisible();

    await Promise.all([
      page.waitForURL(new RegExp(`/votaciones/${election.id}$`)),
      electionCard.click(),
    ]);
    await expect(page).toHaveURL(new RegExp(`/votaciones/${election.id}$`));
    await expect(page.getByRole('heading', { name: votingFixture.uiTitle })).toBeVisible();

    await page.locator('.vote-card').filter({ hasText: votingFixture.optionA }).first().click();

    const castResponse = page.waitForResponse(
      (response) =>
        response.url() === apiUrl('/api/voting/cast') &&
        response.request().method() === 'POST' &&
        response.status() === 200
    );

    await page.getByRole('button', { name: /Emitir voto/i }).click();
    await page.getByRole('button', { name: /Confirmar voto/i }).click();
    await castResponse;

    await expect(page.getByRole('heading', { name: /Voto registrado/i })).toBeVisible();

    const storedVote = await pool.query<{ votes: string; token_used: boolean }>(
      `SELECT COUNT(v.id)::text AS votes, ev.token_used
       FROM election_voters ev
       LEFT JOIN votes v ON v.election_id = ev.election_id AND v.student_id = ev.student_id
       WHERE ev.election_id = $1 AND ev.student_id = $2
       GROUP BY ev.token_used`,
      [election.id, voterUser.studentId]
    );

    expect(storedVote.rows[0]).toEqual(
      expect.objectContaining({
        votes: '1',
        token_used: true,
      })
    );

    const listedAfterVote = await findElectionInVoterList(request, votingFixture.uiTitle);
    expect(listedAfterVote).toEqual(expect.objectContaining({ has_voted: true }));
  });

  test('anonymous users are redirected away from voting UI', async ({ page }) => {
    await page.goto(frontendUrl('/votaciones'));

    await expect(page).toHaveURL(frontendRootRegex());
    await expect(page.getByRole('button', { name: /Continuar con Microsoft/i })).toBeVisible();
  });
});
