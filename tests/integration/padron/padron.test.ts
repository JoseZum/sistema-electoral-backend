import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import XLSX from 'xlsx';

const mockAuth = vi.hoisted(() => ({
  verifySessionJWT: vi.fn(),
}));

const mockDb = vi.hoisted(() => {
  const adminStudentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const voterStudentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const studentOneId = '11111111-1111-4111-8111-111111111111';
  const studentTwoId = '22222222-2222-4222-8222-222222222222';
  const inactiveStudentId = '33333333-3333-4333-8333-333333333333';
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
    created_at: Date;
    updated_at: Date;
  };

  type Admin = {
    id: string;
    students_id: string;
    position_title: string;
    role: string;
    permissions: Record<string, boolean>;
    created_at: Date;
    updated_at: Date;
  };

  let studentSequence = 1;
  let students: Student[] = [];
  let admins: Admin[] = [];
  let lastClient: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> } | null = null;
  let lastImportRows: Record<string, unknown>[] = [];

  function baseStudent(overrides: Partial<Student>): Student {
    return {
      id: '',
      carnet: '',
      full_name: '',
      email: '',
      sede: '',
      career: '',
      degree_level: 'Bachillerato',
      is_active: true,
      created_at: createdAt,
      updated_at: updatedAt,
      ...overrides,
    };
  }

  function nextStudentId() {
    const suffix = String(studentSequence++).padStart(12, '0');
    return `00000000-0000-4000-8000-${suffix}`;
  }

  function resetState() {
    studentSequence = 1;
    lastClient = null;
    lastImportRows = [];
    students = [
      baseStudent({
        id: adminStudentId,
        carnet: '2020000000',
        full_name: 'Admin TEE',
        email: 'admin@estudiantec.cr',
        sede: 'Central',
        career: 'Administracion',
      }),
      baseStudent({
        id: voterStudentId,
        carnet: '2020000001',
        full_name: 'Votante Regular',
        email: 'voter@estudiantec.cr',
        sede: 'Central',
        career: 'Administracion',
      }),
      baseStudent({
        id: studentOneId,
        carnet: '2021001234',
        full_name: 'Ana Garcia',
        email: 'ana@estudiantec.cr',
        sede: 'Central',
        career: 'Ingenieria en Computacion',
      }),
      baseStudent({
        id: studentTwoId,
        carnet: '2021005678',
        full_name: 'Bruno Mora',
        email: 'bruno@estudiantec.cr',
        sede: 'San Carlos',
        career: 'Ingenieria en Produccion Industrial',
        degree_level: 'Licenciatura',
      }),
      baseStudent({
        id: inactiveStudentId,
        carnet: '2021009999',
        full_name: 'Carla Inactiva',
        email: 'carla@estudiantec.cr',
        sede: 'Central',
        career: 'Ingenieria en Computacion',
        is_active: false,
      }),
    ];
    admins = [
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
  }

  function likeMatches(value: string, pattern: unknown) {
    const normalizedValue = value.toLowerCase();
    const normalizedPattern = String(pattern).toLowerCase();
    if (normalizedPattern.startsWith('%') || normalizedPattern.endsWith('%')) {
      return normalizedValue.includes(normalizedPattern.replace(/%/g, ''));
    }
    return normalizedValue === normalizedPattern;
  }

  function activeCatalog() {
    const active = students.filter((student) => student.is_active);
    return {
      sedes: [...new Set(active.map((student) => student.sede).filter(Boolean))].sort(),
      careers: [...new Set(active.map((student) => student.career).filter(Boolean))].sort(),
    };
  }

  function filterStudents(sql: string, params: unknown[]) {
    const filterParams = sql.includes('ORDER BY full_name ASC') ? params.slice(0, -2) : params;
    let paramIndex = 0;
    let rows = [...students];

    if (sql.includes('sede ILIKE')) {
      const sede = filterParams[paramIndex++];
      rows = rows.filter((student) => likeMatches(student.sede, sede));
    }
    if (sql.includes('career ILIKE')) {
      const career = filterParams[paramIndex++];
      rows = rows.filter((student) => likeMatches(student.career, career));
    }
    if (sql.includes('is_active =')) {
      const isActive = filterParams[paramIndex++];
      rows = rows.filter((student) => student.is_active === isActive);
    }
    if (sql.includes('(full_name ILIKE')) {
      const search = filterParams[paramIndex++];
      rows = rows.filter(
        (student) => likeMatches(student.full_name, search) || likeMatches(student.carnet, search)
      );
    }

    return rows.sort((left, right) => left.full_name.localeCompare(right.full_name));
  }

  function applyImport(rows: Record<string, unknown>[]) {
    lastImportRows = rows;
    const validRows = rows.filter(
      (row) => String(row.Carnet || '').trim() && row.Nombre && row.Correo
    );
    const incomingCarnets = validRows.map((row) => String(row.Carnet).trim());
    let newCount = 0;
    let reactivated = 0;

    for (const row of validRows) {
      const carnet = String(row.Carnet).trim();
      const existing = students.find((student) => student.carnet === carnet);
      const data = {
        carnet,
        full_name: String(row.Nombre).trim(),
        email: String(row.Correo).trim(),
        sede: String(row.Sede || '').trim(),
        career: String(row.Carrera || '').trim(),
        degree_level: String(row.Grado || 'NO_ESPECIFICADO').trim(),
      };

      if (!existing) {
        newCount += 1;
        students.push(baseStudent({ id: nextStudentId(), ...data, is_active: true }));
        continue;
      }

      if (!existing.is_active) {
        reactivated += 1;
      }

      Object.assign(existing, data, { is_active: true, updated_at: updatedAt });
    }

    let deactivated = 0;
    students.forEach((student) => {
      if (student.is_active && !incomingCarnets.includes(student.carnet)) {
        student.is_active = false;
        student.updated_at = updatedAt;
        deactivated += 1;
      }
    });

    return {
      total: validRows.length,
      new: newCount,
      updated: validRows.length - newCount - reactivated,
      reactivated,
      deactivated,
    };
  }

  async function runQuery(sqlInput: string, params: unknown[] = []) {
    const sql = sqlInput.replace(/\s+/g, ' ').trim();

    if (
      sql === 'BEGIN' ||
      sql === 'COMMIT' ||
      sql === 'ROLLBACK' ||
      sql.startsWith('SET LOCAL')
    ) {
      return { rows: [], rowCount: 0 };
    }

    if (sql.startsWith('SELECT * FROM admins WHERE students_id = $1')) {
      const admin = admins.find((item) => item.students_id === params[0]);
      return { rows: admin ? [admin] : [], rowCount: admin ? 1 : 0 };
    }

    if (sql.startsWith('SELECT * FROM students WHERE email = $1 AND is_active = true')) {
      const email = String(params[0]).toLowerCase();
      const student = students.find((item) => item.email.toLowerCase() === email && item.is_active);
      return { rows: student ? [student] : [], rowCount: student ? 1 : 0 };
    }

    if (sql.startsWith('SELECT * FROM students WHERE carnet = $1 AND is_active = true')) {
      const student = students.find((item) => item.carnet === params[0] && item.is_active);
      return { rows: student ? [student] : [], rowCount: student ? 1 : 0 };
    }

    if (sql.startsWith('SELECT * FROM students WHERE id = $1')) {
      const student = students.find((item) => item.id === params[0]);
      return { rows: student ? [student] : [], rowCount: student ? 1 : 0 };
    }

    if (sql.startsWith('SELECT DISTINCT sede FROM students')) {
      const rows = activeCatalog().sedes.map((sede) => ({ sede }));
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith('SELECT DISTINCT career FROM students')) {
      const rows = activeCatalog().careers.map((career) => ({ career }));
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith('SELECT COUNT(*) FROM students')) {
      const count = filterStudents(sql, params).length;
      return { rows: [{ count: String(count) }], rowCount: 1 };
    }

    if (sql.startsWith('SELECT * FROM students') && sql.includes('ORDER BY full_name ASC')) {
      const limit = Number(params.at(-2));
      const offset = Number(params.at(-1));
      const rows = filterStudents(sql, params).slice(offset, offset + limit);
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith('INSERT INTO students')) {
      const student = baseStudent({
        id: nextStudentId(),
        carnet: String(params[0]),
        full_name: String(params[1]),
        email: String(params[2]),
        sede: String(params[3]),
        career: String(params[4]),
        degree_level: String(params[5]),
      });
      students.push(student);
      return { rows: [student], rowCount: 1 };
    }

    if (sql.startsWith('UPDATE students SET is_active = false')) {
      const student = students.find((item) => item.id === params[0]);
      if (!student) return { rows: [], rowCount: 0 };
      student.is_active = false;
      student.updated_at = updatedAt;
      return { rows: [student], rowCount: 1 };
    }

    if (sql.startsWith('UPDATE students SET')) {
      const id = params[params.length - 1];
      const student = students.find((item) => item.id === id);
      if (!student) return { rows: [], rowCount: 0 };

      let paramIndex = 0;
      if (sql.includes('full_name = $')) student.full_name = String(params[paramIndex++]);
      if (sql.includes('email = $')) student.email = String(params[paramIndex++]);
      if (sql.includes('sede = $')) student.sede = String(params[paramIndex++]);
      if (sql.includes('career = $')) student.career = String(params[paramIndex++]);
      if (sql.includes('degree_level = $')) student.degree_level = String(params[paramIndex++]);
      if (sql.includes('is_active = $')) student.is_active = Boolean(params[paramIndex++]);
      student.updated_at = updatedAt;

      return { rows: [student], rowCount: 1 };
    }

    if (sql.startsWith('SELECT fn_import_students($1::jsonb) as summary')) {
      const rows = JSON.parse(String(params[0])) as Record<string, unknown>[];
      const summary = applyImport(rows);
      return { rows: [{ summary }], rowCount: 1 };
    }

    throw new Error(`Unhandled SQL in padron integration test: ${sql}`);
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
    },
    query,
    connect,
    resetState,
    getLastClient: () => lastClient,
    getLastImportRows: () => lastImportRows,
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

function makePadronWorkbook(rows: unknown[][]) {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['Padron electoral'],
    ['Tribunal Electoral Estudiantil'],
    [],
    ['Carnet', 'Nombre completo', 'Correo', 'Sede', 'Carrera', 'Grado'],
    ...rows,
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Padron');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('padron integration', () => {
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

  async function uploadPadron(buffer: Buffer, token: string | null = 'admin-token') {
    const formData = new FormData();
    formData.append(
      'file',
      new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      'padron.xlsx'
    );

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${baseUrl}/api/users/students/import`, {
      method: 'POST',
      headers,
      body: formData,
    });
    const body = await response.json();
    return { response, body };
  }

  it('rejects requests without a bearer token', async () => {
    const { response, body } = await request('GET', '/api/users/students', { token: null });

    expect(response.status).toBe(401);
    expect(body.error).toContain('Falta el header de');
    expect(body.error).toContain('inv');
  });

  it('rejects authenticated users that are not admins', async () => {
    const { response, body } = await request('GET', '/api/users/students', { token: 'voter-token' });

    expect(response.status).toBe(403);
    expect(body.error).toBe('Se requieren permisos administrativos para esta accion.');
  });

  it('lists active students with filters and pagination', async () => {
    const { response, body } = await request(
      'GET',
      '/api/users/students?sede=Central&search=ana&page=1&limit=5'
    );

    expect(response.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.students).toEqual([
      expect.objectContaining({
        id: mockDb.ids.studentOneId,
        carnet: '2021001234',
        full_name: 'Ana Garcia',
        is_active: true,
      }),
    ]);
  });

  it('can list inactive students when requested explicitly', async () => {
    const { response, body } = await request('GET', '/api/users/students?is_active=false');

    expect(response.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.students[0]).toEqual(
      expect.objectContaining({
        id: mockDb.ids.inactiveStudentId,
        full_name: 'Carla Inactiva',
        is_active: false,
      })
    );
  });

  it('returns the active padron catalog', async () => {
    const { response, body } = await request('GET', '/api/users/students/catalog');

    expect(response.status).toBe(200);
    expect(body).toEqual({
      sedes: ['Central', 'San Carlos'],
      careers: [
        'Administracion',
        'Ingenieria en Computacion',
        'Ingenieria en Produccion Industrial',
      ],
    });
  });

  it('returns a student detail by id', async () => {
    const { response, body } = await request('GET', `/api/users/students/${mockDb.ids.studentTwoId}`);

    expect(response.status).toBe(200);
    expect(body).toEqual(
      expect.objectContaining({
        id: mockDb.ids.studentTwoId,
        carnet: '2021005678',
        full_name: 'Bruno Mora',
        degree_level: 'Licenciatura',
      })
    );
  });

  it('returns 404 when a student id does not exist', async () => {
    const { response, body } = await request(
      'GET',
      '/api/users/students/99999999-9999-4999-8999-999999999999'
    );

    expect(response.status).toBe(404);
    expect(body).toEqual(
      expect.objectContaining({
        code: 'STUDENT_NOT_FOUND',
        error: 'Estudiante no encontrado',
      })
    );
  });

  it('creates a student using the current catalog and audit context', async () => {
    const { response, body } = await request('POST', '/api/users/students', {
      body: {
        carnet: '2022000001',
        full_name: 'Daniela Rojas',
        email: 'daniela@estudiantec.cr',
        sede: 'Central',
        career: 'Ingenieria en Computacion',
        degree_level: 'Bachillerato',
      },
    });

    expect(response.status).toBe(201);
    expect(body).toEqual(
      expect.objectContaining({
        id: '00000000-0000-4000-8000-000000000001',
        carnet: '2022000001',
        full_name: 'Daniela Rojas',
        is_active: true,
      })
    );
    expect(mockDb.getLastClient()?.release).toHaveBeenCalledOnce();
  });

  it('returns 409 when creating a student with an existing email', async () => {
    const { response, body } = await request('POST', '/api/users/students', {
      body: {
        carnet: '2022000002',
        full_name: 'Ana Duplicada',
        email: 'ana@estudiantec.cr',
        sede: 'Central',
        career: 'Ingenieria en Computacion',
        degree_level: 'Bachillerato',
      },
    });

    expect(response.status).toBe(409);
    expect(body).toEqual(
      expect.objectContaining({
        code: 'STUDENT_EMAIL_ALREADY_EXISTS',
        error: 'Ya existe un estudiante con ese email',
      })
    );
  });

  it('updates a student after validating catalog values', async () => {
    const { response, body } = await request('PUT', `/api/users/students/${mockDb.ids.studentOneId}`, {
      body: {
        full_name: 'Ana Maria Garcia',
        sede: 'San Carlos',
        career: 'Ingenieria en Produccion Industrial',
      },
    });

    expect(response.status).toBe(200);
    expect(body).toEqual(
      expect.objectContaining({
        id: mockDb.ids.studentOneId,
        full_name: 'Ana Maria Garcia',
        sede: 'San Carlos',
        career: 'Ingenieria en Produccion Industrial',
      })
    );
  });

  it('returns 400 when update uses a sede outside the current padron catalog', async () => {
    const { response, body } = await request('PUT', `/api/users/students/${mockDb.ids.studentOneId}`, {
      body: { sede: 'Cartago Norte' },
    });

    expect(response.status).toBe(400);
    expect(body).toEqual(
      expect.objectContaining({
        code: 'STUDENT_INVALID_SEDE',
      })
    );
  });

  it('deactivates a student instead of deleting the row', async () => {
    const deleted = await request('DELETE', `/api/users/students/${mockDb.ids.studentTwoId}`);
    const inactiveList = await request('GET', '/api/users/students?is_active=false');

    expect(deleted.response.status).toBe(200);
    expect(deleted.body).toEqual(
      expect.objectContaining({
        id: mockDb.ids.studentTwoId,
        is_active: false,
      })
    );
    expect(inactiveList.body.students).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: mockDb.ids.studentTwoId,
          is_active: false,
        }),
      ])
    );
  });

  it('imports an XLSX padron, normalizes rows, and returns the diff summary', async () => {
    const workbook = makePadronWorkbook([
      [
        '2021001234',
        'Ana Importada',
        'ana.importada@estudiantec.cr',
        'Central',
        'Ingenieria en Computacion',
        'Licenciatura',
      ],
      [
        '2021009999',
        'Carla Reactivada',
        'carla@estudiantec.cr',
        'Central',
        'Ingenieria en Computacion',
        'Bachillerato',
      ],
      [
        '2023000001',
        'Estudiante Nuevo',
        'nuevo@estudiantec.cr',
        'Limon',
        'Ingenieria Ambiental',
        '',
      ],
      ['', 'Fila incompleta', 'incompleta@estudiantec.cr', 'Central', 'Administracion', 'Bachillerato'],
    ]);

    const { response, body } = await uploadPadron(workbook);

    expect(response.status).toBe(200);
    expect(body).toEqual({
      total: 3,
      new: 1,
      updated: 1,
      reactivated: 1,
      deactivated: 3,
    });
    expect(mockDb.getLastImportRows()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          Carnet: '2021001234',
          Nombre: 'Ana Importada',
          Correo: 'ana.importada@estudiantec.cr',
          Grado: 'Licenciatura',
        }),
        expect.objectContaining({
          Carnet: '2023000001',
          Nombre: 'Estudiante Nuevo',
          Grado: 'NO_ESPECIFICADO',
        }),
      ])
    );
    expect(mockDb.getLastClient()?.release).toHaveBeenCalledOnce();
  });

  it('returns 400 when importing without a file', async () => {
    const formData = new FormData();
    const response = await fetch(`${baseUrl}/api/users/students/import`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer admin-token',
      },
      body: formData,
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Se requiere un archivo XLSX' });
  });

  it('returns 400 when the XLSX contains no valid padron rows', async () => {
    const workbook = makePadronWorkbook([
      ['', 'Sin carnet', 'sin-carnet@estudiantec.cr', 'Central', 'Administracion', 'Bachillerato'],
    ]);

    const { response, body } = await uploadPadron(workbook);

    expect(response.status).toBe(400);
    expect(body).toEqual(
      expect.objectContaining({
        code: 'PADRON_FILE_NO_VALID_DATA',
        error: 'El archivo no contiene datos vÃ¡lidos',
      })
    );
  });
});
