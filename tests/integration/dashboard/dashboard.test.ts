import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';

const mockAuth = vi.hoisted(() => ({
  verifySessionJWT: vi.fn(),
}));

const mockDb = vi.hoisted(() => {
  const adminStudentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const voterStudentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  const admins = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      students_id: adminStudentId,
      position_title: 'Tribunal Electoral',
      role: 'admin',
      permissions: {},
      created_at: new Date('2026-05-04T12:00:00.000Z'),
      updated_at: new Date('2026-05-04T12:15:00.000Z'),
    },
  ];

  async function runQuery(sqlInput: string, params: unknown[] = []) {
    const sql = sqlInput.replace(/\s+/g, ' ').trim();

    if (sql.startsWith('SELECT * FROM admins WHERE students_id = $1')) {
      const admin = admins.find((item) => item.students_id === params[0]);
      return { rows: admin ? [admin] : [], rowCount: admin ? 1 : 0 };
    }

    throw new Error(`Unhandled SQL in dashboard authorization test: ${sql}`);
  }

  async function runDashboardQuery(sqlInput: string) {
    const sql = sqlInput.replace(/\s+/g, ' ').trim();

    if (sql === 'SELECT COUNT(*) FROM students') {
      return { rows: [{ count: '3' }], rowCount: 1 };
    }

    if (sql === 'SELECT COUNT(*) FROM students WHERE is_active = true') {
      return { rows: [{ count: '2' }], rowCount: 1 };
    }

    if (sql === 'SELECT COUNT(*) FROM elections') {
      return { rows: [{ count: '4' }], rowCount: 1 };
    }

    if (sql === "SELECT COUNT(*) FROM elections WHERE status = 'OPEN'") {
      return { rows: [{ count: '1' }], rowCount: 1 };
    }

    if (sql.startsWith('SELECT COALESCE(SUM(ev.votes_cast), 0) as total')) {
      return { rows: [{ total: '7' }], rowCount: 1 };
    }

    if (sql.startsWith('SELECT COALESCE(SUM(ev.total_voters), 0) as total')) {
      return { rows: [{ total: '10' }], rowCount: 1 };
    }

    if (sql.startsWith('SELECT e.id, e.title, e.start_time')) {
      return {
        rows: [
          {
            id: 'election-open-1',
            title: 'Eleccion abierta',
            start_time: new Date('2026-05-04T10:00:00.000Z'),
            end_time: new Date('2026-05-05T10:00:00.000Z'),
            votes_cast: 7,
            total_voters: 10,
            progress_percentage: '70.0',
          },
        ],
        rowCount: 1,
      };
    }

    throw new Error(`Unhandled dashboard stats SQL: ${sql}`);
  }

  const query = vi.fn(runQuery);
  const connect = vi.fn(async () => ({
    query: vi.fn(runDashboardQuery),
    release: vi.fn(),
  }));

  return {
    ids: {
      adminStudentId,
      voterStudentId,
    },
    query,
    connect,
  };
});

vi.mock('../../../src/modules/auth/services/jwtUtils', () => ({
  verifySessionJWT: mockAuth.verifySessionJWT,
  createSessionJWT: vi.fn(),
}));

vi.mock('../../../src/config/database', () => ({
  pool: {
    query: mockDb.query,
    connect: mockDb.connect,
    on: vi.fn(),
  },
}));

import app from '../../../src/index';

type RequestOptions = {
  token?: string | null;
};

describe('dashboard authorization integration', () => {
  let server: Server;
  let baseUrl: string;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
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
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    consoleErrorSpy.mockRestore();
  });

  beforeEach(() => {
    mockDb.query.mockClear();
    mockDb.connect.mockClear();
    mockAuth.verifySessionJWT.mockReset();
    mockAuth.verifySessionJWT.mockImplementation((token: string) => {
      if (token === 'admin-token') {
        return {
          studentId: mockDb.ids.adminStudentId,
          carnet: '2020000000',
          email: 'admin@estudiantec.cr',
          fullName: 'Admin TEE',
          role: 'admin',
        };
      }

      if (token === 'forged-admin-token') {
        return {
          studentId: mockDb.ids.voterStudentId,
          carnet: '2021001234',
          email: 'voter@estudiantec.cr',
          fullName: 'Votante Regular',
          role: 'admin',
        };
      }

      throw new Error('invalid token');
    });
  });

  async function request(path: string, options: RequestOptions = {}) {
    const headers: Record<string, string> = { Accept: 'application/json' };
    const token = options.token === undefined ? 'admin-token' : options.token;

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${baseUrl}${path}`, { method: 'GET', headers });
    const body = await response.json();
    return { response, body };
  }

  it('rejects dashboard stats without a bearer token', async () => {
    const { response, body } = await request('/api/dashboard/stats', { token: null });

    expect(response.status).toBe(401);
    expect(body.error).toContain('Falta el header de');
    expect(mockDb.connect).not.toHaveBeenCalled();
  });

  it('rejects privilege escalation when a voter forges an admin role in the token', async () => {
    const { response, body } = await request('/api/dashboard/stats', {
      token: 'forged-admin-token',
    });

    expect(response.status).toBe(403);
    expect(body.error).toBe('Se requieren permisos administrativos para esta accion.');
    expect(mockDb.query).toHaveBeenCalledWith(
      'SELECT * FROM admins WHERE students_id = $1',
      [mockDb.ids.voterStudentId]
    );
    expect(mockDb.connect).not.toHaveBeenCalled();
  });

  it('returns dashboard stats only for a database-backed admin', async () => {
    const { response, body } = await request('/api/dashboard/stats');

    expect(response.status).toBe(200);
    expect(body).toEqual({
      totalStudents: 3,
      activeStudents: 2,
      totalElections: 4,
      openElections: 1,
      totalVotes: 7,
      participation: 70,
      ongoingElections: [
        {
          id: 'election-open-1',
          title: 'Eleccion abierta',
          startTime: '2026-05-04T10:00:00.000Z',
          endTime: '2026-05-05T10:00:00.000Z',
          votesCount: 7,
          totalVoters: 10,
          progressPercentage: 70,
        },
      ],
    });
    expect(mockDb.connect).toHaveBeenCalledOnce();
  });
});
