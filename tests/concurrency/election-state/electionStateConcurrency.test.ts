import crypto from 'crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import type { PoolClient } from 'pg';

const CONCURRENT_VOTE_REQUESTS = 50;
const ADMIN_TOKEN = 'election-state-admin';

const mockAuth = vi.hoisted(() => ({
  verifySessionJWT: vi.fn(),
}));

vi.mock('../../../src/modules/auth/services/jwtUtils', () => ({
  verifySessionJWT: mockAuth.verifySessionJWT,
  createSessionJWT: vi.fn(),
}));

import app from '../../../src/index';
import { pool } from '../../../src/config/database';

type ScenarioVoter = {
  id: string;
  carnet: string;
  email: string;
  fullName: string;
  token: string;
};

type Scenario = {
  runId: string;
  electionId: string;
  firstOptionId: string;
  secondOptionId: string;
  adminStudentId: string;
  adminId: string;
  voters: ScenarioVoter[];
};

type JsonResponse = {
  response: Response;
  body: Record<string, unknown> | null;
};

function uuid() {
  return crypto.randomUUID();
}

function buildScenario(voterCount: number): Scenario {
  const runId = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const voters = Array.from({ length: voterCount }, (_, index) => {
    const ordinal = String(index + 1).padStart(2, '0');

    return {
      id: uuid(),
      carnet: `conc-${runId}-v${ordinal}`,
      email: `concurrency-${runId}-v${ordinal}@estudiantec.cr`,
      fullName: `Concurrency Voter ${ordinal}`,
      token: `voter-${ordinal}`,
    };
  });

  return {
    runId,
    electionId: uuid(),
    firstOptionId: uuid(),
    secondOptionId: uuid(),
    adminStudentId: uuid(),
    adminId: uuid(),
    voters,
  };
}

function allStudentIds(scenario: Scenario) {
  return [scenario.adminStudentId, ...scenario.voters.map((voter) => voter.id)];
}

function allCarnets(scenario: Scenario) {
  return [
    `conc-${scenario.runId}-admin`,
    ...scenario.voters.map((voter) => voter.carnet),
  ];
}

function auditResourceIds(scenario: Scenario) {
  return [
    scenario.electionId,
    scenario.firstOptionId,
    scenario.secondOptionId,
    scenario.adminId,
    ...allStudentIds(scenario),
  ];
}

async function cleanupScenario(scenario: Scenario) {
  await pool.query('DELETE FROM votes WHERE election_id = $1', [scenario.electionId]);
  await pool.query('DELETE FROM voting_tokens WHERE election_id = $1', [scenario.electionId]);
  await pool.query('DELETE FROM scrutiny_keys WHERE election_id = $1', [scenario.electionId]);
  await pool.query('DELETE FROM election_voters WHERE election_id = $1', [scenario.electionId]);
  await pool.query('DELETE FROM election_options WHERE election_id = $1', [scenario.electionId]);
  await pool.query('DELETE FROM elections WHERE id = $1', [scenario.electionId]);
  await pool.query('DELETE FROM admins WHERE id = $1 OR students_id = $2', [
    scenario.adminId,
    scenario.adminStudentId,
  ]);
  await pool.query('DELETE FROM students WHERE id = ANY($1::uuid[])', [
    allStudentIds(scenario),
  ]);
  await pool.query(
    `DELETE FROM audit_logs
     WHERE resource_id = ANY($1::text[])
        OR actor_id = ANY($2::uuid[])
        OR actor_carnet = ANY($3::text[])`,
    [auditResourceIds(scenario), allStudentIds(scenario), allCarnets(scenario)]
  );
}

async function seedScenario(scenario: Scenario) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const studentIds = allStudentIds(scenario);
    const carnets = allCarnets(scenario);
    const fullNames = ['Concurrency Admin', ...scenario.voters.map((voter) => voter.fullName)];
    const emails = [
      `concurrency-${scenario.runId}-admin@estudiantec.cr`,
      ...scenario.voters.map((voter) => voter.email),
    ];
    const sedes = studentIds.map(() => 'Central');
    const careers = studentIds.map(() => 'Ingenieria en Computacion');
    const degreeLevels = studentIds.map(() => 'Bachillerato');
    const activeFlags = studentIds.map(() => true);

    await client.query(
      `INSERT INTO students (id, carnet, full_name, email, sede, career, degree_level, is_active)
       SELECT *
       FROM unnest(
         $1::uuid[],
         $2::text[],
         $3::text[],
         $4::text[],
         $5::text[],
         $6::text[],
         $7::text[],
         $8::boolean[]
       )`,
      [studentIds, carnets, fullNames, emails, sedes, careers, degreeLevels, activeFlags]
    );

    await client.query(
      `INSERT INTO admins (id, students_id, position_title, role, permissions)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        scenario.adminId,
        scenario.adminStudentId,
        'Concurrency Test Admin',
        'admin',
        JSON.stringify({ elections: true }),
      ]
    );

    await client.query(
      `INSERT INTO elections (
         id, title, description, status, is_anonymous, auth_method, voter_source,
         starts_immediately, requires_keys, min_keys, start_time, end_time, created_by
       )
       VALUES (
         $1, $2, $3, 'OPEN'::election_status, false, 'MICROSOFT'::auth_method_type,
         'MANUAL'::voter_source_type, false, false, 1, now() - interval '1 minute',
         now() + interval '1 hour', $4
       )`,
      [
        scenario.electionId,
        `Concurrency election-state ${scenario.runId}`,
        'Election used only by the election-state concurrency tests.',
        scenario.adminStudentId,
      ]
    );

    await client.query(
      `INSERT INTO election_options (id, election_id, label, option_type, display_order)
       VALUES
         ($1, $2, 'Aceptar', 'yes_no', 1),
         ($3, $2, 'Rechazar', 'yes_no', 2)`,
      [scenario.firstOptionId, scenario.electionId, scenario.secondOptionId]
    );

    await client.query(
      `INSERT INTO election_voters (election_id, student_id)
       SELECT $1, unnest($2::uuid[])`,
      [scenario.electionId, scenario.voters.map((voter) => voter.id)]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function configureAuth(scenario: Scenario) {
  mockAuth.verifySessionJWT.mockReset();
  mockAuth.verifySessionJWT.mockImplementation((token: string) => {
    if (token === ADMIN_TOKEN) {
      return {
        studentId: scenario.adminStudentId,
        carnet: `conc-${scenario.runId}-admin`,
        email: `concurrency-${scenario.runId}-admin@estudiantec.cr`,
        fullName: 'Concurrency Admin',
        role: 'admin',
      };
    }

    const voter = scenario.voters.find((item) => item.token === token);
    if (voter) {
      return {
        studentId: voter.id,
        carnet: voter.carnet,
        email: voter.email,
        fullName: voter.fullName,
        role: 'voter',
      };
    }

    throw new Error('invalid token');
  });
}

async function rollbackQuietly(client: PoolClient) {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Best effort cleanup for a transaction that may already be closed.
  }
}

function countStatus(results: JsonResponse[], status: number) {
  return results.filter((result) => result.response.status === status).length;
}

describe('election state concurrency', () => {
  let server: Server | null = null;
  let baseUrl = '';
  let currentScenario: Scenario | null = null;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await pool.query('SELECT 1');

    server = await new Promise<Server>((resolve) => {
      const runningServer = app.listen(0, () => resolve(runningServer));
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Could not resolve test server address');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()));
      });
    }

    await pool.end();
    consoleErrorSpy.mockRestore();
  });

  beforeEach(async () => {
    currentScenario = buildScenario(CONCURRENT_VOTE_REQUESTS);
    await cleanupScenario(currentScenario);
    await seedScenario(currentScenario);
    configureAuth(currentScenario);
  });

  afterEach(async () => {
    if (currentScenario) {
      await cleanupScenario(currentScenario);
      currentScenario = null;
    }
  });

  async function request(
    method: 'POST' | 'PUT',
    path: string,
    options: { token: string; body: Record<string, unknown> }
  ): Promise<JsonResponse> {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${options.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(options.body),
    });
    const body = await response.json().catch(() => null);
    return { response, body };
  }

  async function countVotes(electionId: string) {
    const result = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM votes WHERE election_id = $1',
      [electionId]
    );
    return result.rows[0].count;
  }

  async function countVotersMarkedAsVoted(electionId: string) {
    const result = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM election_voters
       WHERE election_id = $1
         AND token_used = true`,
      [electionId]
    );
    return result.rows[0].count;
  }

  it('rejects 50 vote requests submitted after the close operation commits', async () => {
    const scenario = currentScenario;
    if (!scenario) {
      throw new Error('Missing test scenario');
    }

    const closeResult = await request('PUT', `/api/elections/${scenario.electionId}/status`, {
      token: ADMIN_TOKEN,
      body: { status: 'CLOSED' },
    });

    expect(closeResult.response.status).toBe(200);
    expect(closeResult.body).toMatchObject({
      id: scenario.electionId,
      status: 'CLOSED',
    });

    const voteResults = await Promise.all(
      scenario.voters.map((voter) =>
        request('POST', '/api/voting/cast', {
          token: voter.token,
          body: {
            electionId: scenario.electionId,
            optionId: scenario.firstOptionId,
          },
        })
      )
    );

    expect(countStatus(voteResults, 409)).toBe(CONCURRENT_VOTE_REQUESTS);
    expect(
      new Set(voteResults.map((result) => result.body?.code))
    ).toEqual(new Set(['VOTING_NOT_OPEN']));
    expect(await countVotes(scenario.electionId)).toBe(0);
    expect(await countVotersMarkedAsVoted(scenario.electionId)).toBe(0);
  });

  it('rejects a stale in-flight vote transaction after another operation closes the election', async () => {
    const scenario = currentScenario;
    if (!scenario) {
      throw new Error('Missing test scenario');
    }

    const voter = scenario.voters[0];
    const voteClient = await pool.connect();
    let castError: unknown = null;

    try {
      await voteClient.query('BEGIN');

      const initialRead = await voteClient.query<{ status: string }>(
        `SELECT e.status
         FROM elections e
         INNER JOIN election_voters ev ON ev.election_id = e.id
         WHERE e.id = $1
           AND ev.student_id = $2`,
        [scenario.electionId, voter.id]
      );
      expect(initialRead.rows[0].status).toBe('OPEN');

      const closeResult = await pool.query<{ status: string }>(
        `UPDATE elections
         SET status = 'CLOSED'::election_status
         WHERE id = $1
         RETURNING status`,
        [scenario.electionId]
      );
      expect(closeResult.rows[0].status).toBe('CLOSED');

      // Expectation: the DB layer must re-check the current election status.
      // A request that observed OPEN earlier must not insert once CLOSED is committed.
      try {
        await voteClient.query('SELECT fn_cast_vote_named($1, $2, $3)', [
          scenario.electionId,
          scenario.firstOptionId,
          voter.id,
        ]);
      } catch (error) {
        castError = error;
      }
    } finally {
      await rollbackQuietly(voteClient);
      voteClient.release();
    }

    expect(await countVotes(scenario.electionId)).toBe(0);
    expect(await countVotersMarkedAsVoted(scenario.electionId)).toBe(0);

    if (!castError) {
      throw new Error(
        'Expected fn_cast_vote_named to reject after the election was CLOSED, but it accepted a stale in-flight vote.'
      );
    }
    expect(castError).toBeInstanceOf(Error);
  });
});
