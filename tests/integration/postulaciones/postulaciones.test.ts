import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';

/**
 * Estos tests cubren la capa de rutas: quien puede llamar a que, y como se
 * traducen los errores de dominio a codigos HTTP.
 *
 * Se mockean los repositorios en vez de simular Postgres: la logica SQL ya la
 * ejerce el esquema y las reglas puras tienen su propia bateria en
 * tests/unit/postulaciones.
 */

const ADMIN_STUDENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VOTER_STUDENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER_STUDENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const FORM_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const APPLICATION_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const FILE_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const POSITION_ID = '11111111-1111-4111-8111-111111111111';

const mockAuth = vi.hoisted(() => ({ verifySessionJWT: vi.fn() }));

const mockDatabase = vi.hoisted(() => {
  const client = {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: vi.fn(),
  };
  return {
    pool: {
      connect: vi.fn().mockResolvedValue(client),
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    },
    client,
  };
});

const mockAdminRepo = vi.hoisted(() => ({ findAdminByStudentId: vi.fn() }));

const mockStudentRepo = vi.hoisted(() => ({
  findStudentById: vi.fn(),
  findStudentByEmail: vi.fn(),
  findStudentByCarnet: vi.fn(),
  findStudentCatalog: vi.fn(),
}));

const mockRepo = vi.hoisted(() => ({
  syncAutomaticStatuses: vi.fn(),
  findAllForms: vi.fn(),
  findFormById: vi.fn(),
  findFormRawById: vi.fn(),
  insertForm: vi.fn(),
  updateForm: vi.fn(),
  deleteForm: vi.fn(),
  findPositionsByForm: vi.fn(),
  findPositionsWithUsage: vi.fn(),
  findPositionById: vi.fn(),
  insertPosition: vi.fn(),
  updatePositionName: vi.fn(),
  deletePosition: vi.fn(),
  countApplicationsByPosition: vi.fn(),
  clearEligibility: vi.fn(),
  populateEligibilityFromPadron: vi.fn(),
  populateEligibilityFromTag: vi.fn(),
  populateEligibilityManual: vi.fn(),
  countEligibility: vi.fn(),
  isStudentEligible: vi.fn(),
  findApplicationsByForm: vi.fn(),
  findApplicationById: vi.fn(),
  findApplicationByStudent: vi.fn(),
  insertApplication: vi.fn(),
  updateApplicationData: vi.fn(),
  markApplicationSubmitted: vi.fn(),
  applyReview: vi.fn(),
  insertReview: vi.fn(),
  findReviewsByApplication: vi.fn(),
  findFilesByApplication: vi.fn(),
  findFileWithContent: vi.fn(),
  findFileMeta: vi.fn(),
  upsertFile: vi.fn(),
  deleteFile: vi.fn(),
  buildApplicationDetail: vi.fn(),
  findFormsForStudent: vi.fn(),
}));

vi.mock('../../../src/config/database', () => ({ pool: mockDatabase.pool }));
vi.mock('../../../src/modules/auth/services/jwtUtils', () => mockAuth);
vi.mock('../../../src/modules/users/repositories/adminRepository', () => mockAdminRepo);
vi.mock('../../../src/modules/users/repositories/studentRepository', () => mockStudentRepo);
vi.mock(
  '../../../src/modules/postulaciones/repositories/postulacionRepository',
  () => mockRepo
);

import app from '../../../src/index';

let server: Server;
let baseUrl: string;

const openForm = {
  id: FORM_ID,
  title: 'Postulacion TEE 2026',
  description: null,
  status: 'OPEN',
  start_time: null,
  end_time: null,
  allow_other_documents: false,
  other_documents_label: null,
  voter_source: 'FULL_PADRON',
  voter_filter: null,
  tag_id: null,
  election_id: null,
  created_by: null,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
};

const draftApplication = {
  id: APPLICATION_ID,
  form_id: FORM_ID,
  student_id: VOTER_STUDENT_ID,
  status: 'DRAFT',
  last_name_1: null,
  last_name_2: null,
  first_name: null,
  email: 'voter@estudiantec.cr',
  national_id: null,
  carnet: null,
  phone: null,
  sede: null,
  career: null,
  unlocked_fields: null,
  correction_deadline: null,
  review_comment: null,
  reviewed_by: null,
  reviewed_at: null,
  submitted_at: null,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
};

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();

  mockAuth.verifySessionJWT.mockImplementation((token: string) => {
    if (token === 'admin-token') {
      return {
        studentId: ADMIN_STUDENT_ID,
        carnet: '2020000000',
        email: 'admin@estudiantec.cr',
        fullName: 'Admin TEE',
        role: 'admin',
      };
    }
    if (token === 'voter-token') {
      return {
        studentId: VOTER_STUDENT_ID,
        carnet: '2020000001',
        email: 'voter@estudiantec.cr',
        fullName: 'Votante Regular',
        role: 'voter',
      };
    }
    if (token === 'other-token') {
      return {
        studentId: OTHER_STUDENT_ID,
        carnet: '2020000002',
        email: 'otro@estudiantec.cr',
        fullName: 'Otro Estudiante',
        role: 'voter',
      };
    }
    throw new Error('invalid token');
  });

  mockAdminRepo.findAdminByStudentId.mockImplementation(async (studentId: string) =>
    studentId === ADMIN_STUDENT_ID
      ? { id: 'admin-1', students_id: ADMIN_STUDENT_ID, position_title: 'Presidente', role: 'admin' }
      : null
  );

  mockStudentRepo.findStudentById.mockResolvedValue({
    id: VOTER_STUDENT_ID,
    carnet: '2020000001',
    full_name: 'RUIZ ZUMBADO JOSE FABIAN',
    email: 'voter@estudiantec.cr',
    sede: 'Cartago',
    career: 'Ingenieria en Computacion',
    degree_level: '11933044',
    is_active: true,
  });
  mockStudentRepo.findStudentCatalog.mockResolvedValue({
    sedes: ['Cartago'],
    careers: ['Ingenieria en Computacion'],
  });

  mockRepo.syncAutomaticStatuses.mockResolvedValue(undefined);
  mockRepo.findFormRawById.mockResolvedValue(openForm);
  mockRepo.findFormById.mockResolvedValue({ ...openForm, eligible_count: 10 });
  mockRepo.isStudentEligible.mockResolvedValue(true);
  mockRepo.findApplicationByStudent.mockResolvedValue(draftApplication);
  mockRepo.findFilesByApplication.mockResolvedValue([]);
  mockRepo.findReviewsByApplication.mockResolvedValue([]);
  mockRepo.findPositionsByForm.mockResolvedValue([]);
  mockRepo.findPositionsWithUsage.mockResolvedValue([]);
  mockRepo.findAllForms.mockResolvedValue([]);
  mockRepo.findFormsForStudent.mockResolvedValue([]);
  mockRepo.findApplicationsByForm.mockResolvedValue([]);
  mockRepo.updateApplicationData.mockResolvedValue(draftApplication);
});

async function request(
  method: string,
  path: string,
  options: { token?: string; body?: unknown } = {}
) {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  return { response, body };
}

// ============================================
// AUTENTICACION Y AUTORIZACION
// ============================================

describe('/api/postulaciones (admin)', () => {
  const adminRoutes: Array<[string, string]> = [
    ['GET', '/api/postulaciones/formularios'],
    ['POST', '/api/postulaciones/formularios'],
    ['GET', `/api/postulaciones/formularios/${FORM_ID}`],
    ['PUT', `/api/postulaciones/formularios/${FORM_ID}`],
    ['DELETE', `/api/postulaciones/formularios/${FORM_ID}`],
    ['GET', `/api/postulaciones/formularios/${FORM_ID}/respuestas`],
    ['GET', `/api/postulaciones/respuestas/${APPLICATION_ID}`],
    ['POST', `/api/postulaciones/respuestas/${APPLICATION_ID}/revision`],
    ['GET', `/api/postulaciones/archivos/${FILE_ID}`],
    ['GET', `/api/postulaciones/formularios/${FORM_ID}/puestos`],
    ['POST', `/api/postulaciones/formularios/${FORM_ID}/puestos`],
    ['PUT', `/api/postulaciones/puestos/${POSITION_ID}`],
    ['DELETE', `/api/postulaciones/puestos/${POSITION_ID}`],
  ];

  it.each(adminRoutes)('%s %s responde 401 sin bearer', async (method, path) => {
    const { response } = await request(method, path);
    expect(response.status).toBe(401);
  });

  it.each(adminRoutes)('%s %s responde 403 para un votante', async (method, path) => {
    const { response, body } = await request(method, path, {
      token: 'voter-token',
      ...(method === 'GET' ? {} : { body: {} }),
    });

    expect(response.status).toBe(403);
    expect(body.error).toBe('Se requieren permisos administrativos para esta accion.');
  });

  it('lista los formularios para un admin', async () => {
    const { response } = await request('GET', '/api/postulaciones/formularios', {
      token: 'admin-token',
    });

    expect(response.status).toBe(200);
    expect(mockRepo.findAllForms).toHaveBeenCalled();
  });

  it('rechaza crear un formulario sin titulo', async () => {
    const { response, body } = await request('POST', '/api/postulaciones/formularios', {
      token: 'admin-token',
      body: { voter_source: 'FULL_PADRON' },
    });

    expect(response.status).toBe(400);
    expect(body.code).toBe('APPLICATION_FORM_TITLE_REQUIRED');
    expect(mockRepo.insertForm).not.toHaveBeenCalled();
  });

  it('rechaza una audiencia invalida', async () => {
    const { response, body } = await request('POST', '/api/postulaciones/formularios', {
      token: 'admin-token',
      body: { title: 'X', voter_source: 'CUALQUIERA' },
    });

    expect(response.status).toBe(400);
    expect(body.code).toBe('APPLICATION_FORM_INVALID_AUDIENCE');
  });

  it('rechaza una ventana de tiempo invertida', async () => {
    const { response, body } = await request('POST', '/api/postulaciones/formularios', {
      token: 'admin-token',
      body: {
        title: 'X',
        voter_source: 'FULL_PADRON',
        start_time: '2026-12-01T00:00:00Z',
        end_time: '2026-11-01T00:00:00Z',
      },
    });

    expect(response.status).toBe(400);
    expect(body.code).toBe('APPLICATION_FORM_INVALID_WINDOW');
  });

  it('devuelve 404 cuando el formulario no existe', async () => {
    mockRepo.findFormById.mockResolvedValueOnce(null);

    const { response, body } = await request('GET', `/api/postulaciones/formularios/${FORM_ID}`, {
      token: 'admin-token',
    });

    expect(response.status).toBe(404);
    expect(body.code).toBe('APPLICATION_FORM_NOT_FOUND');
  });
});

// ============================================
// REVISION
// ============================================

describe('POST /api/postulaciones/respuestas/:id/revision', () => {
  const path = `/api/postulaciones/respuestas/${APPLICATION_ID}/revision`;

  beforeEach(() => {
    mockRepo.findApplicationById.mockResolvedValue({
      ...draftApplication,
      status: 'SUBMITTED',
      student_full_name: 'Votante Regular',
      student_carnet: '2020000001',
      student_email: 'voter@estudiantec.cr',
      files_count: 5,
    });
  });

  it('rechaza una decision inventada', async () => {
    const { response, body } = await request('POST', path, {
      token: 'admin-token',
      body: { decision: 'SUPERAPROBADO' },
    });

    expect(response.status).toBe(400);
    expect(body.code).toBe('APPLICATION_INVALID_DECISION');
  });

  it('no deja resolver una postulacion que el estudiante no ha enviado', async () => {
    mockRepo.findApplicationById.mockResolvedValueOnce({
      ...draftApplication,
      status: 'DRAFT',
      student_full_name: 'Votante Regular',
      student_carnet: '2020000001',
      student_email: 'voter@estudiantec.cr',
      files_count: 0,
    });

    const { response, body } = await request('POST', path, {
      token: 'admin-token',
      body: { decision: 'APPROVED' },
    });

    expect(response.status).toBe(409);
    expect(body.code).toBe('APPLICATION_NOT_SUBMITTED');
  });

  it('exige al menos un campo desbloqueado al condicionar', async () => {
    const { response, body } = await request('POST', path, {
      token: 'admin-token',
      body: {
        decision: 'CONDITIONED',
        unlocked_fields: [],
        correction_deadline: '2027-01-01T00:00:00Z',
      },
    });

    expect(response.status).toBe(400);
    expect(body.code).toBe('APPLICATION_NO_UNLOCKED_FIELDS');
  });

  it('descarta claves inventadas al contar los campos desbloqueados', async () => {
    const { response, body } = await request('POST', path, {
      token: 'admin-token',
      body: {
        decision: 'CONDITIONED',
        unlocked_fields: ['campo_inventado', 'email'],
        correction_deadline: '2027-01-01T00:00:00Z',
      },
    });

    // 'email' nunca es desbloqueable y la otra clave no existe: no queda nada.
    expect(response.status).toBe(400);
    expect(body.code).toBe('APPLICATION_NO_UNLOCKED_FIELDS');
  });

  it('exige un plazo de correccion al condicionar', async () => {
    const { response, body } = await request('POST', path, {
      token: 'admin-token',
      body: { decision: 'CONDITIONED', unlocked_fields: ['last_name_2'] },
    });

    expect(response.status).toBe(400);
    expect(body.code).toBe('APPLICATION_DEADLINE_REQUIRED');
  });

  it('rechaza un plazo de correccion ya vencido', async () => {
    const { response, body } = await request('POST', path, {
      token: 'admin-token',
      body: {
        decision: 'CONDITIONED',
        unlocked_fields: ['last_name_2'],
        correction_deadline: '2020-01-01T00:00:00Z',
      },
    });

    expect(response.status).toBe(400);
    expect(body.code).toBe('APPLICATION_DEADLINE_IN_PAST');
  });

  it('devuelve 404 si la postulacion no existe', async () => {
    mockRepo.findApplicationById.mockResolvedValueOnce(null);

    const { response, body } = await request('POST', path, {
      token: 'admin-token',
      body: { decision: 'APPROVED' },
    });

    expect(response.status).toBe(404);
    expect(body.code).toBe('APPLICATION_NOT_FOUND');
  });
});

// ============================================
// LADO DEL ESTUDIANTE
// ============================================

describe('/api/mis-postulaciones (estudiante)', () => {
  it('responde 401 sin bearer', async () => {
    const { response } = await request('GET', '/api/mis-postulaciones');
    expect(response.status).toBe(401);
  });

  it('deja que un votante liste sus formularios', async () => {
    const { response } = await request('GET', '/api/mis-postulaciones', { token: 'voter-token' });

    expect(response.status).toBe(200);
    expect(mockRepo.findFormsForStudent).toHaveBeenCalledWith(VOTER_STUDENT_ID);
  });

  it('oculta con 404 un formulario para el que el estudiante no es elegible', async () => {
    mockRepo.isStudentEligible.mockResolvedValueOnce(false);

    const { response, body } = await request('GET', `/api/mis-postulaciones/${FORM_ID}`, {
      token: 'voter-token',
    });

    expect(response.status).toBe(404);
    expect(body.code).toBe('APPLICATION_FORM_NOT_FOUND');
  });

  it('oculta con 404 un formulario en borrador del admin', async () => {
    mockRepo.findFormRawById.mockResolvedValueOnce({ ...openForm, status: 'DRAFT' });

    const { response, body } = await request('GET', `/api/mis-postulaciones/${FORM_ID}`, {
      token: 'voter-token',
    });

    expect(response.status).toBe(404);
    expect(body.code).toBe('APPLICATION_FORM_NOT_FOUND');
  });

  it('devuelve el prellenado con el correo bloqueado y la cedula deducida del padron', async () => {
    const { response, body } = await request('GET', `/api/mis-postulaciones/${FORM_ID}`, {
      token: 'voter-token',
    });

    expect(response.status).toBe(200);

    const prefill = body.prefill as Record<string, unknown>;
    expect(prefill.email).toBe('voter@estudiantec.cr');
    expect(prefill.locked_fields).toEqual(['email']);
    expect(prefill.national_id).toBe('11933044');
    expect(prefill.last_name_1).toBe('RUIZ');
    expect(prefill.first_name).toBe('JOSE FABIAN');
    expect(body.sedes).toEqual(['Cartago']);
  });

  it('descarta los campos que el estudiante no tiene desbloqueados', async () => {
    mockRepo.findApplicationByStudent.mockResolvedValue({
      ...draftApplication,
      status: 'CONDITIONED',
      unlocked_fields: ['last_name_2'],
      correction_deadline: '2027-01-01T00:00:00Z',
    });

    const { response } = await request('PUT', `/api/mis-postulaciones/${FORM_ID}`, {
      token: 'voter-token',
      body: { last_name_1: 'HACKEADO', last_name_2: 'Corregido', phone: '11111111' },
    });

    expect(response.status).toBe(200);
    expect(mockRepo.updateApplicationData).toHaveBeenCalledWith(
      APPLICATION_ID,
      { last_name_2: 'Corregido' },
      expect.anything()
    );
  });

  it('bloquea la edicion de una postulacion ya enviada', async () => {
    mockRepo.findApplicationByStudent.mockResolvedValue({
      ...draftApplication,
      status: 'SUBMITTED',
    });

    const { response, body } = await request('PUT', `/api/mis-postulaciones/${FORM_ID}`, {
      token: 'voter-token',
      body: { last_name_1: 'X' },
    });

    expect(response.status).toBe(409);
    expect(body.code).toBe('APPLICATION_ALREADY_SUBMITTED');
    expect(mockRepo.updateApplicationData).not.toHaveBeenCalled();
  });

  it('bloquea la edicion de una postulacion ya resuelta', async () => {
    mockRepo.findApplicationByStudent.mockResolvedValue({
      ...draftApplication,
      status: 'APPROVED',
    });

    const { response, body } = await request('PUT', `/api/mis-postulaciones/${FORM_ID}`, {
      token: 'voter-token',
      body: { last_name_1: 'X' },
    });

    expect(response.status).toBe(409);
    expect(body.code).toBe('APPLICATION_ALREADY_RESOLVED');
  });

  it('bloquea la correccion cuando el plazo ya vencio', async () => {
    mockRepo.findApplicationByStudent.mockResolvedValue({
      ...draftApplication,
      status: 'CONDITIONED',
      unlocked_fields: ['last_name_2'],
      correction_deadline: '2020-01-01T00:00:00Z',
    });

    const { response, body } = await request('PUT', `/api/mis-postulaciones/${FORM_ID}`, {
      token: 'voter-token',
      body: { last_name_2: 'Tarde' },
    });

    expect(response.status).toBe(409);
    expect(body.code).toBe('APPLICATION_CORRECTION_EXPIRED');
  });

  it('impide enviar el formulario incompleto y dice que falta', async () => {
    const { response, body } = await request('POST', `/api/mis-postulaciones/${FORM_ID}/enviar`, {
      token: 'voter-token',
    });

    expect(response.status).toBe(400);
    expect(body.code).toBe('APPLICATION_INCOMPLETE');
    expect(String(body.error)).toContain('Informe de matrícula');
    expect(mockRepo.markApplicationSubmitted).not.toHaveBeenCalled();
  });
});

// ============================================
// PUESTOS
// ============================================

describe('puestos', () => {
  const basePath = `/api/postulaciones/formularios/${FORM_ID}/puestos`;

  const position = {
    id: POSITION_ID,
    form_id: FORM_ID,
    name: 'Presidencia',
    display_order: 0,
    created_at: '2026-08-29T00:00:00Z',
    updated_at: '2026-08-29T00:00:00Z',
  };

  it('rechaza un nombre vacio', async () => {
    const { response, body } = await request('POST', basePath, {
      token: 'admin-token',
      body: { name: '   ' },
    });

    expect(response.status).toBe(400);
    expect(body.code).toBe('APPLICATION_POSITION_NAME_REQUIRED');
    expect(mockRepo.insertPosition).not.toHaveBeenCalled();
  });

  it('rechaza un puesto duplicado ignorando mayusculas y espacios', async () => {
    mockRepo.findPositionsByForm.mockResolvedValueOnce([position]);

    const { response, body } = await request('POST', basePath, {
      token: 'admin-token',
      body: { name: '  presidencia ' },
    });

    expect(response.status).toBe(409);
    expect(body.code).toBe('APPLICATION_POSITION_DUPLICATED');
    expect(mockRepo.insertPosition).not.toHaveBeenCalled();
  });

  it('crea un puesto con el nombre normalizado', async () => {
    mockRepo.insertPosition.mockResolvedValue(position);

    const { response } = await request('POST', basePath, {
      token: 'admin-token',
      body: { name: '  Presidencia  ' },
    });

    expect(response.status).toBe(201);
    expect(mockRepo.insertPosition).toHaveBeenCalledWith(
      FORM_ID,
      'Presidencia',
      expect.anything()
    );
  });

  it('no deja borrar un puesto que ya tiene postulaciones', async () => {
    mockRepo.findPositionById.mockResolvedValue(position);
    mockRepo.countApplicationsByPosition.mockResolvedValue(3);

    const { response, body } = await request('DELETE', `/api/postulaciones/puestos/${POSITION_ID}`, {
      token: 'admin-token',
    });

    expect(response.status).toBe(409);
    expect(body.code).toBe('APPLICATION_POSITION_IN_USE');
    expect(String(body.error)).toContain('3');
    expect(mockRepo.deletePosition).not.toHaveBeenCalled();
  });

  it('borra un puesto sin postulaciones', async () => {
    mockRepo.findPositionById.mockResolvedValue(position);
    mockRepo.countApplicationsByPosition.mockResolvedValue(0);

    const { response } = await request('DELETE', `/api/postulaciones/puestos/${POSITION_ID}`, {
      token: 'admin-token',
    });

    expect(response.status).toBe(200);
    expect(mockRepo.deletePosition).toHaveBeenCalled();
  });

  it('devuelve 404 al editar un puesto inexistente', async () => {
    mockRepo.findPositionById.mockResolvedValue(null);

    const { response, body } = await request('PUT', `/api/postulaciones/puestos/${POSITION_ID}`, {
      token: 'admin-token',
      body: { name: 'Otro' },
    });

    expect(response.status).toBe(404);
    expect(body.code).toBe('APPLICATION_POSITION_NOT_FOUND');
  });

  it('impide postularse a un puesto de otro formulario', async () => {
    mockRepo.findPositionsByForm.mockResolvedValue([position]);

    const { response, body } = await request('PUT', `/api/mis-postulaciones/${FORM_ID}`, {
      token: 'voter-token',
      body: { position_id: '99999999-9999-4999-8999-999999999999' },
    });

    expect(response.status).toBe(400);
    expect(body.code).toBe('APPLICATION_POSITION_INVALID');
    expect(mockRepo.updateApplicationData).not.toHaveBeenCalled();
  });

  it('acepta un puesto del propio formulario', async () => {
    mockRepo.findPositionsByForm.mockResolvedValue([position]);

    const { response } = await request('PUT', `/api/mis-postulaciones/${FORM_ID}`, {
      token: 'voter-token',
      body: { position_id: POSITION_ID },
    });

    expect(response.status).toBe(200);
    expect(mockRepo.updateApplicationData).toHaveBeenCalledWith(
      APPLICATION_ID,
      { position_id: POSITION_ID },
      expect.anything()
    );
  });

  it('exige elegir puesto al enviar si el formulario define alguno', async () => {
    mockRepo.findPositionsByForm.mockResolvedValue([position]);

    const { response, body } = await request('POST', `/api/mis-postulaciones/${FORM_ID}/enviar`, {
      token: 'voter-token',
    });

    expect(response.status).toBe(400);
    expect(String(body.error)).toContain('Puesto al que se postula');
  });
});

// ============================================
// ADJUNTOS
// ============================================

describe('adjuntos', () => {
  async function upload(fieldKey: string, token: string, content = '%PDF-1.4 contenido') {
    const formData = new FormData();
    formData.append('file', new Blob([content], { type: 'application/pdf' }), 'doc.pdf');

    const response = await fetch(
      `${baseUrl}/api/mis-postulaciones/${FORM_ID}/archivos/${fieldKey}`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: formData }
    );

    return { response, body: await response.json().catch(() => ({})) };
  }

  it('rechaza un field_key inexistente', async () => {
    const { response, body } = await upload('inventado', 'voter-token');

    expect(response.status).toBe(400);
    expect(body.code).toBe('APPLICATION_INVALID_FILE_FIELD');
  });

  it('rechaza "otros documentos" si el formulario no los habilito', async () => {
    const { response, body } = await upload('other', 'voter-token');

    expect(response.status).toBe(400);
    expect(body.code).toBe('APPLICATION_OTHER_DOCS_DISABLED');
  });

  it('rechaza un ejecutable renombrado a .pdf', async () => {
    const { response, body } = await upload('id_copy', 'voter-token', 'MZ\x90\x00 binario falso');

    expect(response.status).toBe(400);
    expect(body.code).toBe('APPLICATION_FILE_TYPE_NOT_ALLOWED');
    expect(mockRepo.upsertFile).not.toHaveBeenCalled();
  });

  it('rechaza subir a un campo bloqueado en una postulacion condicionada', async () => {
    mockRepo.findApplicationByStudent.mockResolvedValue({
      ...draftApplication,
      status: 'CONDITIONED',
      unlocked_fields: ['carnet_copy'],
      correction_deadline: '2027-01-01T00:00:00Z',
    });

    const { response, body } = await upload('tdf_letter', 'voter-token');

    expect(response.status).toBe(403);
    expect(body.code).toBe('APPLICATION_FIELD_LOCKED');
    expect(mockRepo.upsertFile).not.toHaveBeenCalled();
  });

  it('guarda el archivo con el tipo detectado, no el declarado', async () => {
    mockRepo.upsertFile.mockResolvedValue({ id: FILE_ID, field_key: 'id_copy' });

    const { response } = await upload('id_copy', 'voter-token');

    expect(response.status).toBe(201);
    expect(mockRepo.upsertFile).toHaveBeenCalledWith(
      APPLICATION_ID,
      'id_copy',
      expect.objectContaining({ mimeType: 'application/pdf', fileName: 'doc.pdf' }),
      expect.anything()
    );
  });

  it('no deja que un estudiante lea el archivo de otro', async () => {
    mockRepo.findFileWithContent.mockResolvedValue({
      id: FILE_ID,
      application_id: APPLICATION_ID,
      field_key: 'id_copy',
      file_name: 'doc.pdf',
      mime_type: 'application/pdf',
      size_bytes: 10,
      uploaded_at: '2026-08-01T00:00:00Z',
      content: Buffer.from('%PDF-1.4'),
    });
    mockRepo.findApplicationById.mockResolvedValue({
      ...draftApplication,
      student_id: VOTER_STUDENT_ID,
    });

    const { response, body } = await request('GET', `/api/mis-postulaciones/archivos/${FILE_ID}`, {
      token: 'other-token',
    });

    expect(response.status).toBe(404);
    expect(body.code).toBe('APPLICATION_FILE_NOT_FOUND');
  });

  it('sirve el archivo propio con cabeceras seguras', async () => {
    mockRepo.findFileWithContent.mockResolvedValue({
      id: FILE_ID,
      application_id: APPLICATION_ID,
      field_key: 'id_copy',
      file_name: 'doc.pdf',
      mime_type: 'application/pdf',
      size_bytes: 8,
      uploaded_at: '2026-08-01T00:00:00Z',
      content: Buffer.from('%PDF-1.4'),
    });
    mockRepo.findApplicationById.mockResolvedValue({
      ...draftApplication,
      student_id: VOTER_STUDENT_ID,
    });

    const response = await fetch(`${baseUrl}/api/mis-postulaciones/archivos/${FILE_ID}`, {
      headers: { Authorization: 'Bearer voter-token' },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toBe('inline; filename="doc.pdf"');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
