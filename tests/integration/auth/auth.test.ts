import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';

import { AppError } from '../../../src/errors/appError';
import type { MicrosoftIdTokenClaims } from '../../../src/modules/auth/models/authModel';

const mockMicrosoft = vi.hoisted(() => ({
  verifyMicrosoftIdToken: vi.fn(),
}));

const mockDb = vi.hoisted(() => {
  const voterStudentId = '11111111-1111-4111-8111-111111111111';
  const adminStudentId = '22222222-2222-4222-8222-222222222222';
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

  let students: Student[] = [];
  let admins: Admin[] = [];

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

  function resetState() {
    students = [
      baseStudent({
        id: voterStudentId,
        carnet: '2021001234',
        full_name: 'Valeria Votante',
        email: 'votante@estudiantec.cr',
        sede: 'Central',
        career: 'Ingenieria en Computacion',
      }),
      baseStudent({
        id: adminStudentId,
        carnet: '2020000001',
        full_name: 'Andrea Admin',
        email: 'admin@estudiantec.cr',
        sede: 'San Carlos',
        career: 'Administracion de Empresas',
      }),
      baseStudent({
        id: '33333333-3333-4333-8333-333333333333',
        carnet: '2020999999',
        full_name: 'Inactiva Padron',
        email: 'inactiva@estudiantec.cr',
        sede: 'Central',
        career: 'Ingenieria Ambiental',
        is_active: false,
      }),
    ];
    admins = [
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        students_id: adminStudentId,
        position_title: 'Tribunal Electoral',
        role: 'admin',
        permissions: {},
        created_at: createdAt,
        updated_at: updatedAt,
      },
    ];
  }

  async function runQuery(sqlInput: string, params: unknown[] = []) {
    const sql = sqlInput.replace(/\s+/g, ' ').trim();

    if (sql.startsWith('SELECT * FROM students WHERE email = $1 AND is_active = true')) {
      const email = String(params[0]).toLowerCase();
      const student = students.find(
        (item) => item.email.toLowerCase() === email && item.is_active
      );
      return { rows: student ? [student] : [], rowCount: student ? 1 : 0 };
    }

    if (sql.startsWith('SELECT * FROM admins WHERE students_id = $1')) {
      const admin = admins.find((item) => item.students_id === params[0]);
      return { rows: admin ? [admin] : [], rowCount: admin ? 1 : 0 };
    }

    throw new Error(`Unhandled SQL in auth integration test: ${sql}`);
  }

  const query = vi.fn(runQuery);

  resetState();

  return {
    ids: {
      voterStudentId,
      adminStudentId,
    },
    query,
    resetState,
  };
});

vi.mock('../../../src/modules/auth/services/microsoftTokenService', () => ({
  verifyMicrosoftIdToken: mockMicrosoft.verifyMicrosoftIdToken,
}));

vi.mock('../../../src/config/database', () => ({
  pool: {
    query: mockDb.query,
    connect: vi.fn(),
    on: vi.fn(),
  },
}));

import app from '../../../src/index';
import { env } from '../../../src/config/env';
import { verifySessionJWT } from '../../../src/modules/auth/services/jwtUtils';

type RequestBody = {
  idToken?: unknown;
};

function claims(overrides: Partial<MicrosoftIdTokenClaims> = {}): MicrosoftIdTokenClaims {
  return {
    iss: 'https://login.microsoftonline.com/tenant-id/v2.0',
    sub: 'microsoft-subject-id',
    aud: 'azure-client-id',
    exp: 1_735_689_600,
    iat: 1_735_660_800,
    email: 'votante@estudiantec.cr',
    ...overrides,
  };
}

describe('auth integration', () => {
  const originalJwtSecret = env.jwtSecret;
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
    env.jwtSecret = originalJwtSecret;
  });

  beforeEach(() => {
    env.jwtSecret = 'auth-integration-session-secret';
    mockDb.resetState();
    mockDb.query.mockClear();
    mockMicrosoft.verifyMicrosoftIdToken.mockReset();
    mockMicrosoft.verifyMicrosoftIdToken.mockResolvedValue(claims());
  });

  async function postMicrosoftAuth(body: RequestBody | string) {
    const headers: Record<string, string> = { Accept: 'application/json' };
    let requestBody: string;

    if (typeof body === 'string') {
      headers['Content-Type'] = 'application/json';
      requestBody = body;
    } else {
      headers['Content-Type'] = 'application/json';
      requestBody = JSON.stringify(body);
    }

    const response = await fetch(`${baseUrl}/api/auth/microsoft`, {
      method: 'POST',
      headers,
      body: requestBody,
    });
    const responseBody = await response.json();
    return { response, body: responseBody };
  }

  it('authenticates an active voter and returns a signed session token', async () => {
    const { response, body } = await postMicrosoftAuth({ idToken: 'valid-voter-token' });

    expect(response.status).toBe(200);
    expect(mockMicrosoft.verifyMicrosoftIdToken).toHaveBeenCalledWith('valid-voter-token');
    expect(mockDb.query).toHaveBeenCalledWith(
      'SELECT * FROM students WHERE email = $1 AND is_active = true',
      ['votante@estudiantec.cr']
    );
    expect(body.user).toEqual({
      studentId: mockDb.ids.voterStudentId,
      carnet: '2021001234',
      fullName: 'Valeria Votante',
      email: 'votante@estudiantec.cr',
      role: 'voter',
      sede: 'Central',
      career: 'Ingenieria en Computacion',
    });

    const session = verifySessionJWT(body.token);
    expect(session).toMatchObject({
      studentId: mockDb.ids.voterStudentId,
      carnet: '2021001234',
      email: 'votante@estudiantec.cr',
      fullName: 'Valeria Votante',
      role: 'voter',
    });
  });

  it('authenticates an admin using preferred_username and normalizes email lookup', async () => {
    mockMicrosoft.verifyMicrosoftIdToken.mockResolvedValue(
      claims({
        email: undefined,
        preferred_username: 'ADMIN@ESTUDIANTEC.CR',
      })
    );

    const { response, body } = await postMicrosoftAuth({ idToken: 'valid-admin-token' });

    expect(response.status).toBe(200);
    expect(mockDb.query).toHaveBeenCalledWith(
      'SELECT * FROM students WHERE email = $1 AND is_active = true',
      ['admin@estudiantec.cr']
    );
    expect(mockDb.query).toHaveBeenCalledWith(
      'SELECT * FROM admins WHERE students_id = $1',
      [mockDb.ids.adminStudentId]
    );
    expect(body.user).toEqual({
      studentId: mockDb.ids.adminStudentId,
      carnet: '2020000001',
      fullName: 'Andrea Admin',
      email: 'admin@estudiantec.cr',
      role: 'admin',
      sede: 'San Carlos',
      career: 'Administracion de Empresas',
    });
    expect(verifySessionJWT(body.token)).toMatchObject({
      studentId: mockDb.ids.adminStudentId,
      role: 'admin',
    });
  });

  it.each([
    ['missing', {}],
    ['empty', { idToken: '' }],
    ['non-string', { idToken: 123 }],
  ])('returns 400 when idToken is %s', async (_caseName, body) => {
    const { response, body: responseBody } = await postMicrosoftAuth(body);

    expect(response.status).toBe(400);
    expect(responseBody).toEqual({
      error: 'Falta el idToken o es invalido en el cuerpo de la peticion.',
      code: 'AUTH_INVALID_REQUEST',
    });
    expect(mockMicrosoft.verifyMicrosoftIdToken).not.toHaveBeenCalled();
    expect(mockDb.query).not.toHaveBeenCalled();
  });

  it('returns 401 when Microsoft claims do not include an email', async () => {
    mockMicrosoft.verifyMicrosoftIdToken.mockResolvedValue(
      claims({
        email: undefined,
        preferred_username: undefined,
      })
    );

    const { response, body } = await postMicrosoftAuth({ idToken: 'missing-email-token' });

    expect(response.status).toBe(401);
    expect(body).toEqual({
      error: 'Autenticacion fallida: no se encontro correo en la cuenta de Microsoft.',
      code: 'AUTH_EMAIL_MISSING',
    });
    expect(mockDb.query).not.toHaveBeenCalled();
  });

  it('returns 403 when the Microsoft account is outside estudiantec.cr', async () => {
    mockMicrosoft.verifyMicrosoftIdToken.mockResolvedValue(
      claims({
        email: 'student@example.com',
      })
    );

    const { response, body } = await postMicrosoftAuth({ idToken: 'external-domain-token' });

    expect(response.status).toBe(403);
    expect(body).toEqual({
      error: 'Solo se permiten cuentas @estudiantec.cr',
      code: 'AUTH_DOMAIN_NOT_ALLOWED',
    });
    expect(mockDb.query).not.toHaveBeenCalled();
  });

  it('returns 404 when the estudiantec account is not active in the padron', async () => {
    mockMicrosoft.verifyMicrosoftIdToken.mockResolvedValue(
      claims({
        email: 'inactiva@estudiantec.cr',
      })
    );

    const { response, body } = await postMicrosoftAuth({ idToken: 'inactive-student-token' });

    expect(response.status).toBe(404);
    expect(body).toEqual({
      error: 'Estudiante no encontrado en el padron electoral. Contacte al TEE.',
      code: 'AUTH_STUDENT_NOT_FOUND',
    });
    expect(mockDb.query).toHaveBeenCalledOnce();
  });

  it('returns provider validation errors from Microsoft token verification', async () => {
    mockMicrosoft.verifyMicrosoftIdToken.mockRejectedValue(
      new AppError({
        status: 401,
        code: 'AUTH_TOKEN_INVALID',
        message: 'Autenticacion fallida: token de Microsoft invalido.',
        details: 'No se pudo decodificar el header del token',
      })
    );

    const { response, body } = await postMicrosoftAuth({ idToken: 'invalid-microsoft-token' });

    expect(response.status).toBe(401);
    expect(body).toEqual(expect.objectContaining({
      error: 'Autenticacion fallida: token de Microsoft invalido.',
      code: 'AUTH_TOKEN_INVALID',
    }));
    expect(mockDb.query).not.toHaveBeenCalled();
  });

  it('returns 400 when the request body is not valid JSON', async () => {
    const { response, body } = await postMicrosoftAuth('{');

    expect(response.status).toBe(400);
    expect(body).toEqual(expect.objectContaining({
      error: 'El cuerpo de la peticion no es JSON valido.',
      code: 'INVALID_JSON_BODY',
    }));
    expect(mockMicrosoft.verifyMicrosoftIdToken).not.toHaveBeenCalled();
    expect(mockDb.query).not.toHaveBeenCalled();
  });
});
