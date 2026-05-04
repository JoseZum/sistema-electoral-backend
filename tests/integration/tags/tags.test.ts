import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';

const mockAuth = vi.hoisted(() => ({
  verifySessionJWT: vi.fn(),
}));

const mockDb = vi.hoisted(() => {
  const adminStudentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const voterStudentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const studentOneId = '11111111-1111-4111-8111-111111111111';
  const studentTwoId = '22222222-2222-4222-8222-222222222222';
  const inactiveStudentId = '33333333-3333-4333-8333-333333333333';
  const duplicateTagId = '99999999-9999-4999-8999-999999999999';
  const createdAt = new Date('2026-05-04T12:00:00.000Z');
  const updatedAt = new Date('2026-05-04T12:15:00.000Z');

  type Student = {
    id: string;
    carnet: string;
    full_name: string;
    email: string;
    sede: string;
    career: string;
    degree_level: string;
    is_active: boolean;
  };

  type Tag = {
    id: string;
    name: string;
    description: string | null;
    color: string;
    created_by: string | null;
    created_at: Date;
    updated_at: Date;
  };

  const students: Student[] = [
    {
      id: adminStudentId,
      carnet: '2020000000',
      full_name: 'Admin TEE',
      email: 'admin@estudiantec.cr',
      sede: 'Central',
      career: 'Administracion',
      degree_level: 'Bachillerato',
      is_active: true,
    },
    {
      id: voterStudentId,
      carnet: '2020000001',
      full_name: 'Votante Regular',
      email: 'voter@estudiantec.cr',
      sede: 'Central',
      career: 'Administracion',
      degree_level: 'Bachillerato',
      is_active: true,
    },
    {
      id: studentOneId,
      carnet: '2021001234',
      full_name: 'Ana Garcia',
      email: 'ana@estudiantec.cr',
      sede: 'Central',
      career: 'Ingenieria en Computacion',
      degree_level: 'Bachillerato',
      is_active: true,
    },
    {
      id: studentTwoId,
      carnet: '2021005678',
      full_name: 'Bruno Mora',
      email: 'bruno@estudiantec.cr',
      sede: 'San Carlos',
      career: 'Ingenieria en Produccion Industrial',
      degree_level: 'Licenciatura',
      is_active: true,
    },
    {
      id: inactiveStudentId,
      carnet: '2021009999',
      full_name: 'Carla Inactiva',
      email: 'carla@estudiantec.cr',
      sede: 'Central',
      career: 'Ingenieria en Computacion',
      degree_level: 'Bachillerato',
      is_active: false,
    },
  ];

  const admins = [
    {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      students_id: adminStudentId,
      position_title: 'Tribunal Electoral',
      role: 'admin',
      permissions: {},
      created_at: createdAt,
      updated_at: updatedAt,
    },
  ];

  let tagSequence = 1;
  let tags: Tag[] = [];
  let tagMembers: Array<{ tag_id: string; student_id: string }> = [];
  let lastClient: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> } | null = null;

  function nextTagId() {
    const suffix = String(tagSequence++).padStart(12, '0');
    return `00000000-0000-4000-8000-${suffix}`;
  }

  function resetState() {
    tagSequence = 1;
    tags = [
      {
        id: duplicateTagId,
        name: 'Existente',
        description: 'Tag sembrada',
        color: '#C62828',
        created_by: adminStudentId,
        created_at: createdAt,
        updated_at: updatedAt,
      },
    ];
    tagMembers = [{ tag_id: duplicateTagId, student_id: studentOneId }];
    lastClient = null;
  }

  function activeStudentById(id: string) {
    return students.find((student) => student.id === id && student.is_active) || null;
  }

  function tagRow(tag: Tag) {
    return {
      ...tag,
      member_count: tagMembers.filter((member) => member.tag_id === tag.id).length,
    };
  }

  function tagMembersFor(tagId: string) {
    return tagMembers
      .filter((member) => member.tag_id === tagId)
      .map((member) => {
        const student = activeStudentById(member.student_id);
        if (!student) return null;
        return {
          tag_id: tagId,
          id: student.id,
          carnet: student.carnet,
          full_name: student.full_name,
          sede: student.sede,
          career: student.career,
          degree_level: student.degree_level,
          is_active: student.is_active,
        };
      })
      .filter(Boolean)
      .sort((left: any, right: any) => left.full_name.localeCompare(right.full_name));
  }

  async function runQuery(sqlInput: string, params: unknown[] = []) {
    const sql = sqlInput.replace(/\s+/g, ' ').trim();

    if (
      sql === 'BEGIN' ||
      sql === 'COMMIT' ||
      sql === 'ROLLBACK' ||
      sql.startsWith('SET LOCAL') ||
      sql.startsWith('SELECT set_config') ||
      sql.startsWith('WITH target AS')
    ) {
      return { rows: [], rowCount: 0 };
    }

    if (sql.startsWith('SELECT * FROM admins WHERE students_id = $1')) {
      const admin = admins.find((item) => item.students_id === params[0]);
      return { rows: admin ? [admin] : [], rowCount: admin ? 1 : 0 };
    }

    if (sql.startsWith('SELECT id FROM students WHERE id = ANY($1::uuid[])')) {
      const requestedIds = (params[0] as string[]) || [];
      const rows = requestedIds
        .filter((id) => activeStudentById(id))
        .map((id) => ({ id }));
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith('SELECT t.id') && sql.includes('FROM tags t') && sql.includes('WHERE t.id = $1')) {
      const tag = tags.find((item) => item.id === params[0]);
      return { rows: tag ? [tagRow(tag)] : [], rowCount: tag ? 1 : 0 };
    }

    if (sql.startsWith('SELECT t.id') && sql.includes('FROM tags t') && sql.includes('WHERE LOWER(t.name) = LOWER($1)')) {
      const name = String(params[0]).toLowerCase();
      const tag = tags.find((item) => item.name.toLowerCase() === name);
      return { rows: tag ? [tagRow(tag)] : [], rowCount: tag ? 1 : 0 };
    }

    if (sql.startsWith('SELECT t.id') && sql.includes('FROM tags t') && sql.includes('ORDER BY t.name ASC')) {
      const rows = tags
        .map(tagRow)
        .sort((left, right) => left.name.localeCompare(right.name));
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith('SELECT tm.tag_id') && sql.includes('FROM tag_members tm')) {
      const rows = tagMembersFor(String(params[0]));
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith('SELECT student_id::text AS student_id FROM tag_members')) {
      const rows = tagMembers
        .filter((member) => member.tag_id === params[0])
        .map((member) => ({ student_id: member.student_id }));
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith('INSERT INTO tags')) {
      const tag: Tag = {
        id: nextTagId(),
        name: String(params[0]),
        description: (params[1] as string | null) || null,
        color: String(params[2]),
        created_by: (params[3] as string | null) || null,
        created_at: createdAt,
        updated_at: updatedAt,
      };
      tags.push(tag);
      return { rows: [{ ...tagRow(tag), member_count: 0 }], rowCount: 1 };
    }

    if (sql.startsWith('UPDATE tags SET')) {
      const id = params[params.length - 1] as string;
      const tag = tags.find((item) => item.id === id);
      if (!tag) return { rows: [], rowCount: 0 };

      let paramIndex = 0;
      if (sql.includes('name = $')) tag.name = String(params[paramIndex++]);
      if (sql.includes('description = $')) tag.description = (params[paramIndex++] as string | null) || null;
      if (sql.includes('color = $')) tag.color = String(params[paramIndex++]);
      tag.updated_at = updatedAt;

      return { rows: [tagRow(tag)], rowCount: 1 };
    }

    if (sql === 'DELETE FROM tag_members WHERE tag_id = $1') {
      const before = tagMembers.length;
      tagMembers = tagMembers.filter((member) => member.tag_id !== params[0]);
      return { rows: [], rowCount: before - tagMembers.length };
    }

    if (sql.startsWith('INSERT INTO tag_members')) {
      const tagIds = params[0] as string[];
      const studentIds = params[1] as string[];
      let inserted = 0;

      tagIds.forEach((tagId, index) => {
        const studentId = studentIds[index];
        const exists = tagMembers.some((member) => member.tag_id === tagId && member.student_id === studentId);
        if (!exists) {
          tagMembers.push({ tag_id: tagId, student_id: studentId });
          inserted += 1;
        }
      });

      return { rows: [], rowCount: inserted };
    }

    if (sql.startsWith('DELETE FROM tag_members WHERE tag_id = $1 AND student_id = ANY($2::uuid[])')) {
      const tagId = params[0];
      const studentIds = params[1] as string[];
      const before = tagMembers.length;
      tagMembers = tagMembers.filter(
        (member) => member.tag_id !== tagId || !studentIds.includes(member.student_id)
      );
      return { rows: [], rowCount: before - tagMembers.length };
    }

    if (sql.startsWith('DELETE FROM tags WHERE id = $1')) {
      const before = tags.length;
      tags = tags.filter((tag) => tag.id !== params[0]);
      tagMembers = tagMembers.filter((member) => member.tag_id !== params[0]);
      return { rows: [], rowCount: before - tags.length };
    }

    throw new Error(`Unhandled SQL in tags integration test: ${sql}`);
  }

  const query = vi.fn(runQuery);
  const connect = vi.fn(async () => {
    const client = {
      query: vi.fn((sql: string, params?: unknown[]) => query(sql, params || [])),
      release: vi.fn(),
    };
    lastClient = client;
    return client;
  });

  resetState();

  return {
    ids: {
      adminStudentId,
      voterStudentId,
      studentOneId,
      studentTwoId,
      inactiveStudentId,
      duplicateTagId,
    },
    query,
    connect,
    resetState,
    getLastClient: () => lastClient,
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
  body?: unknown;
};

describe('tags integration', () => {
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
    mockDb.resetState();
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

      if (token === 'voter-token') {
        return {
          studentId: mockDb.ids.voterStudentId,
          carnet: '2020000001',
          email: 'voter@estudiantec.cr',
          fullName: 'Votante Regular',
          role: 'voter',
        };
      }

      throw new Error('invalid token');
    });
  });

  async function request(method: string, path: string, options: RequestOptions = {}) {
    const headers: Record<string, string> = { Accept: 'application/json' };
    const token = options.token === undefined ? 'admin-token' : options.token;

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const body = await response.json();
    return { response, body };
  }

  it('rejects requests without a bearer token', async () => {
    const { response, body } = await request('GET', '/api/tags', { token: null });

    expect(response.status).toBe(401);
    expect(body.error).toContain('Falta el header de');
    expect(body.error).toContain('inv');
  });

  it('rejects authenticated users that are not admins', async () => {
    const { response, body } = await request('GET', '/api/tags', { token: 'voter-token' });

    expect(response.status).toBe(403);
    expect(body.error).toBe('Se requieren permisos administrativos para esta accion.');
  });

  it('lists existing tags for an admin user', async () => {
    const { response, body } = await request('GET', '/api/tags');

    expect(response.status).toBe(200);
    expect(body).toEqual([
      expect.objectContaining({
        id: mockDb.ids.duplicateTagId,
        name: 'Existente',
        description: 'Tag sembrada',
        color: '#C62828',
        member_count: 1,
        created_by: mockDb.ids.adminStudentId,
      }),
    ]);
  });

  it('creates a tag, normalizes input, and returns its active members', async () => {
    const { response, body } = await request('POST', '/api/tags', {
      body: {
        name: '  Ciencias   Exactas  ',
        description: 'Estudiantes habilitados',
        color: '#ad1457',
        student_ids: [mockDb.ids.studentTwoId, mockDb.ids.studentOneId, mockDb.ids.studentOneId],
      },
    });

    expect(response.status).toBe(201);
    expect(body).toEqual(
      expect.objectContaining({
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Ciencias Exactas',
        description: 'Estudiantes habilitados',
        color: '#AD1457',
        member_count: 2,
        created_by: mockDb.ids.adminStudentId,
      })
    );
    expect(body.members).toEqual([
      expect.objectContaining({ id: mockDb.ids.studentOneId, full_name: 'Ana Garcia' }),
      expect.objectContaining({ id: mockDb.ids.studentTwoId, full_name: 'Bruno Mora' }),
    ]);
    expect(mockDb.getLastClient()?.release).toHaveBeenCalledOnce();
  });

  it('fetches a tag detail after creation', async () => {
    const created = await request('POST', '/api/tags', {
      body: {
        name: 'Ingenierias',
        student_ids: [mockDb.ids.studentOneId],
      },
    });

    const { response, body } = await request('GET', `/api/tags/${created.body.id}`);

    expect(response.status).toBe(200);
    expect(body.name).toBe('Ingenierias');
    expect(body.color).toBe('#C62828');
    expect(body.member_count).toBe(1);
    expect(body.members).toEqual([
      expect.objectContaining({
        id: mockDb.ids.studentOneId,
        carnet: '2021001234',
        is_active: true,
      }),
    ]);
  });

  it('updates tag fields and replaces members', async () => {
    const created = await request('POST', '/api/tags', {
      body: {
        name: 'Original',
        color: '#283593',
        student_ids: [mockDb.ids.studentOneId],
      },
    });

    const { response, body } = await request('PUT', `/api/tags/${created.body.id}`, {
      body: {
        name: 'Actualizada',
        description: '',
        color: '#006064',
        student_ids: [mockDb.ids.studentTwoId],
      },
    });

    expect(response.status).toBe(200);
    expect(body).toEqual(
      expect.objectContaining({
        id: created.body.id,
        name: 'Actualizada',
        description: null,
        color: '#006064',
        member_count: 1,
      })
    );
    expect(body.members).toEqual([
      expect.objectContaining({ id: mockDb.ids.studentTwoId, full_name: 'Bruno Mora' }),
    ]);
  });

  it('deletes a tag and returns 404 when it is requested again', async () => {
    const created = await request('POST', '/api/tags', {
      body: {
        name: 'Temporal',
        student_ids: [mockDb.ids.studentOneId],
      },
    });

    const deleted = await request('DELETE', `/api/tags/${created.body.id}`);
    const fetched = await request('GET', `/api/tags/${created.body.id}`);

    expect(deleted.response.status).toBe(200);
    expect(deleted.body).toEqual({ success: true });
    expect(fetched.response.status).toBe(404);
    expect(fetched.body).toEqual(expect.objectContaining({
      code: 'TAG_NOT_FOUND',
      error: 'Tag no encontrada',
    }));
  });

  it('returns 409 when creating a tag with an existing name', async () => {
    const { response, body } = await request('POST', '/api/tags', {
      body: {
        name: ' existente ',
        student_ids: [mockDb.ids.studentOneId],
      },
    });

    expect(response.status).toBe(409);
    expect(body).toEqual(expect.objectContaining({
      code: 'TAG_NAME_ALREADY_EXISTS',
      error: 'Se necesita un nombre unico para la tag',
    }));
  });

  it('returns 400 when the tag color is not allowed', async () => {
    const { response, body } = await request('POST', '/api/tags', {
      body: {
        name: 'Color invalido',
        color: '#FFFFFF',
        student_ids: [mockDb.ids.studentOneId],
      },
    });

    expect(response.status).toBe(400);
    expect(body).toEqual(expect.objectContaining({
      code: 'TAG_INVALID_COLOR',
      error: 'Selecciona un color valido para la tag',
    }));
  });

  it('returns 404 when a requested member is not active in the padron', async () => {
    const { response, body } = await request('POST', '/api/tags', {
      body: {
        name: 'Inactivos',
        student_ids: [mockDb.ids.inactiveStudentId],
      },
    });

    expect(response.status).toBe(404);
    expect(body).toEqual(expect.objectContaining({
      code: 'TAG_STUDENT_NOT_FOUND',
      error: 'Estudiante no encontrado en el padron',
    }));
  });
});
