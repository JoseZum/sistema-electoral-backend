import { PoolClient } from 'pg';
import { pool } from '../../../config/database';
import { withAuditContext } from '../../../config/audit-context';
import { badRequest, conflict, forbidden, notFound } from '../../../errors/httpErrors';
import { findStudentById, findStudentCatalog } from '../../users/repositories/studentRepository';
import * as repo from '../repositories/postulacionRepository';
import {
  Application,
  ApplicationFileContent,
  ApplicationFileMeta,
  ApplicationPrefill,
  AuditActor,
  MyApplicationDetail,
  MyApplicationFormSummary,
  SaveApplicationDto,
} from '../models/postulacionModel';
import {
  FIELD_LABELS,
  FileFieldKey,
  MAX_FILE_BYTES,
  isFileFieldKey,
} from '../constants/applicationFields';
import {
  assertAllowedFile,
  assertInstitutionalEmail,
  canStudentWrite,
  decodeMultipartFileName,
  findMissingFields,
  guessNationalIdFromDegreeLevel,
  normalizeDigits,
  normalizeText,
  pickEditableData,
  resolveEditableFields,
  sanitizeFileName,
  splitFullName,
} from './applicationRules';

async function withOptionalAudit<T>(
  actor: AuditActor | undefined,
  fn: (client?: PoolClient) => Promise<T>
): Promise<T> {
  if (actor?.id || actor?.carnet || actor?.ip) {
    return withAuditContext(actor, (client) => fn(client));
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Carga el formulario y comprueba que este estudiante puede verlo.
 *
 * Un estudiante fuera de la audiencia recibe 404 y no 403: no tiene por que
 * enterarse de que existe un formulario dirigido a otra gente.
 */
async function loadFormForStudent(formId: string, studentId: string) {
  await repo.syncAutomaticStatuses();

  const form = await repo.findFormRawById(formId);
  if (!form || form.status === 'DRAFT' || form.status === 'ARCHIVED') {
    throw notFound('APPLICATION_FORM_NOT_FOUND', 'Formulario de postulación no encontrado');
  }

  const eligible = await repo.isStudentEligible(formId, studentId);
  if (!eligible) {
    throw notFound('APPLICATION_FORM_NOT_FOUND', 'Formulario de postulación no encontrado');
  }

  return form;
}

/**
 * Sugerencias tomadas del padron y de la sesion de Microsoft.
 *
 * Todo es editable salvo el correo, que se fija al de la sesion para que
 * nadie pueda postularse en nombre de otra persona.
 */
async function buildPrefill(studentId: string, sessionEmail: string): Promise<ApplicationPrefill> {
  const student = await findStudentById(studentId);
  const name = splitFullName(student?.full_name);

  return {
    ...name,
    email: assertInstitutionalEmail(sessionEmail),
    national_id: guessNationalIdFromDegreeLevel(student?.degree_level),
    carnet: student?.carnet ?? '',
    sede: student?.sede ?? '',
    career: student?.career ?? '',
    locked_fields: ['email'],
  };
}

export async function listMyForms(studentId: string): Promise<MyApplicationFormSummary[]> {
  await repo.syncAutomaticStatuses();

  const forms = await repo.findFormsForStudent(studentId);

  return forms.map((form) => ({
    ...form,
    can_edit: canStudentWrite(
      form.application_status
        ? ({
            status: form.application_status,
            correction_deadline: form.correction_deadline,
          } as Application)
        : null,
      { status: form.status, allow_other_documents: form.allow_other_documents }
    ).allowed,
  }));
}

export async function getMyApplication(
  formId: string,
  studentId: string,
  sessionEmail: string
): Promise<MyApplicationDetail> {
  const form = await loadFormForStudent(formId, studentId);
  const application = await repo.findApplicationByStudent(formId, studentId);

  const [files, reviews, prefill, catalog] = await Promise.all([
    application ? repo.findFilesByApplication(application.id) : Promise.resolve([]),
    application ? repo.findReviewsByApplication(application.id) : Promise.resolve([]),
    buildPrefill(studentId, sessionEmail),
    findStudentCatalog(),
  ]);

  const writable = canStudentWrite(application, form);

  return {
    form: {
      id: form.id,
      title: form.title,
      description: form.description,
      status: form.status,
      start_time: form.start_time,
      end_time: form.end_time,
      allow_other_documents: form.allow_other_documents,
      other_documents_label: form.other_documents_label,
      application_status: application?.status ?? null,
      submitted_at: application?.submitted_at ?? null,
      correction_deadline: application?.correction_deadline ?? null,
      review_comment: application?.review_comment ?? null,
      can_edit: writable.allowed,
    },
    application,
    files,
    reviews,
    prefill,
    editable_fields: writable.allowed ? resolveEditableFields(application, form) : [],
    sedes: catalog.sedes,
    careers: catalog.careers,
  };
}

/**
 * Devuelve la postulacion del estudiante creandola si hace falta, tras
 * verificar que en este momento tiene permiso para escribir.
 */
async function getWritableApplication(
  formId: string,
  studentId: string,
  sessionEmail: string,
  actor?: AuditActor
): Promise<{ application: Application; form: Awaited<ReturnType<typeof loadFormForStudent>> }> {
  const form = await loadFormForStudent(formId, studentId);
  let application = await repo.findApplicationByStudent(formId, studentId);

  const writable = canStudentWrite(application, form);
  if (!writable.allowed) {
    const reason = writable.reason!;
    // 409: el recurso existe y el estudiante tiene acceso, pero su estado
    // actual no admite la operacion.
    throw conflict(reason.code, reason.message);
  }

  if (!application) {
    application = await withOptionalAudit(actor, (client) =>
      repo.insertApplication(formId, studentId, assertInstitutionalEmail(sessionEmail), client)
    );
  }

  return { application, form };
}

/**
 * Guarda el borrador.
 *
 * Todo campo que el estudiante no tenga desbloqueado se descarta aqui: el
 * frontend deshabilita los inputs por comodidad, pero la garantia real es
 * este recorte contra `resolveEditableFields`.
 */
export async function saveMyApplication(
  formId: string,
  studentId: string,
  sessionEmail: string,
  data: SaveApplicationDto,
  actor?: AuditActor
): Promise<MyApplicationDetail> {
  const { application, form } = await getWritableApplication(formId, studentId, sessionEmail, actor);

  const editableFields = resolveEditableFields(application, form);
  const allowed = pickEditableData(data as Record<string, unknown>, editableFields);

  const normalized: SaveApplicationDto = {};
  if (allowed.last_name_1 !== undefined) normalized.last_name_1 = normalizeText(allowed.last_name_1 as string);
  if (allowed.last_name_2 !== undefined) normalized.last_name_2 = normalizeText(allowed.last_name_2 as string);
  if (allowed.first_name !== undefined) normalized.first_name = normalizeText(allowed.first_name as string);
  if (allowed.sede !== undefined) normalized.sede = normalizeText(allowed.sede as string);
  if (allowed.career !== undefined) normalized.career = normalizeText(allowed.career as string);
  if (allowed.national_id !== undefined) {
    normalized.national_id = normalizeDigits(allowed.national_id as string, 'national_id');
  }
  if (allowed.carnet !== undefined) {
    normalized.carnet = normalizeDigits(allowed.carnet as string, 'carnet');
  }
  if (allowed.phone !== undefined) {
    normalized.phone = normalizeDigits(allowed.phone as string, 'phone');
  }

  await withOptionalAudit(actor, (client) =>
    repo.updateApplicationData(application.id, normalized, client)
  );

  return getMyApplication(formId, studentId, sessionEmail);
}

/**
 * Envia o reenvia la postulacion.
 *
 * "Impedir que el usuario envie el formulario si no ha llenado todas las
 * opciones": si falta algo se devuelve 400 con la lista de lo que falta.
 */
export async function submitMyApplication(
  formId: string,
  studentId: string,
  sessionEmail: string,
  actor?: AuditActor
): Promise<MyApplicationDetail> {
  const { application } = await getWritableApplication(formId, studentId, sessionEmail, actor);

  const files = await repo.findFilesByApplication(application.id);
  const missing = findMissingFields(application, files);

  if (missing.length > 0) {
    throw badRequest(
      'APPLICATION_INCOMPLETE',
      `Falta completar: ${missing.join(', ')}`,
      { missing }
    );
  }

  await withOptionalAudit(actor, (client) => repo.markApplicationSubmitted(application.id, client));

  return getMyApplication(formId, studentId, sessionEmail);
}

// ============================================
// ADJUNTOS
// ============================================

export async function uploadMyFile(
  formId: string,
  studentId: string,
  sessionEmail: string,
  fieldKey: string,
  file: { buffer: Buffer; originalname: string },
  actor?: AuditActor
): Promise<ApplicationFileMeta> {
  if (!isFileFieldKey(fieldKey)) {
    throw badRequest('APPLICATION_INVALID_FILE_FIELD', 'El campo de archivo indicado no existe');
  }

  const { application, form } = await getWritableApplication(formId, studentId, sessionEmail, actor);

  if (fieldKey === 'other' && !form.allow_other_documents) {
    throw badRequest(
      'APPLICATION_OTHER_DOCS_DISABLED',
      'Este formulario no acepta documentos adicionales'
    );
  }

  const editableFields = resolveEditableFields(application, form);
  if (!editableFields.includes(fieldKey)) {
    throw forbidden(
      'APPLICATION_FIELD_LOCKED',
      `No puedes modificar "${FIELD_LABELS[fieldKey]}" en este momento`
    );
  }

  if (!file?.buffer || file.buffer.length === 0) {
    throw badRequest('APPLICATION_FILE_EMPTY', 'El archivo llegó vacío');
  }
  if (file.buffer.length > MAX_FILE_BYTES) {
    throw badRequest(
      'APPLICATION_FILE_TOO_LARGE',
      `El archivo no puede pasar de ${MAX_FILE_BYTES / (1024 * 1024)} MB`
    );
  }

  // Se guarda el tipo DETECTADO, no el que declaró el navegador.
  const mimeType = assertAllowedFile(file.buffer, file.originalname);

  return withOptionalAudit(actor, (client) =>
    repo.upsertFile(
      application.id,
      fieldKey as FileFieldKey,
      {
        // multer entrega el nombre en latin1: hay que reinterpretarlo antes
        // de sanear, si no las tildes se guardan corrompidas.
        fileName: sanitizeFileName(decodeMultipartFileName(file.originalname)),
        mimeType,
        content: file.buffer,
      },
      client
    )
  );
}

export async function deleteMyFile(
  formId: string,
  studentId: string,
  sessionEmail: string,
  fileId: string,
  actor?: AuditActor
): Promise<void> {
  const { application, form } = await getWritableApplication(formId, studentId, sessionEmail, actor);

  const file = await repo.findFileMeta(fileId);
  if (!file || file.application_id !== application.id) {
    throw notFound('APPLICATION_FILE_NOT_FOUND', 'Archivo no encontrado');
  }

  const editableFields = resolveEditableFields(application, form);
  if (!editableFields.includes(file.field_key)) {
    throw forbidden(
      'APPLICATION_FIELD_LOCKED',
      `No puedes modificar "${FIELD_LABELS[file.field_key]}" en este momento`
    );
  }

  await withOptionalAudit(actor, (client) => repo.deleteFile(fileId, client));
}

/**
 * Sirve un adjunto propio. Se comprueba que el archivo pertenezca a una
 * postulacion de ESTE estudiante; si no, 404 (no 403, para no confirmar
 * que el id existe).
 */
export async function getMyFile(
  studentId: string,
  fileId: string
): Promise<ApplicationFileContent> {
  const file = await repo.findFileWithContent(fileId);
  if (!file) {
    throw notFound('APPLICATION_FILE_NOT_FOUND', 'Archivo no encontrado');
  }

  const application = await repo.findApplicationById(file.application_id);
  if (!application || application.student_id !== studentId) {
    throw notFound('APPLICATION_FILE_NOT_FOUND', 'Archivo no encontrado');
  }

  return file;
}
