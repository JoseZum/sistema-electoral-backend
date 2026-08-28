import { PoolClient } from 'pg';
import { pool } from '../../../config/database';
import { withAuditContext } from '../../../config/audit-context';
import { badRequest, conflict, notFound } from '../../../errors/httpErrors';
import * as repo from '../repositories/postulacionRepository';
import {
  ApplicationDetail,
  ApplicationFileContent,
  ApplicationFormStatus,
  ApplicationFormWithStats,
  ApplicationStatus,
  ApplicationSummary,
  AuditActor,
  CreateApplicationFormDto,
  ReviewApplicationDto,
  UpdateApplicationFormDto,
  VoterSource,
} from '../models/postulacionModel';
import { normalizeText, normalizeUnlockedFields } from './applicationRules';

const VOTER_SOURCES: VoterSource[] = ['FULL_PADRON', 'FILTERED', 'MANUAL', 'TAG'];
const APPLICATION_STATUSES: ApplicationStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'CONDITIONED',
  'REJECTED',
];

/**
 * Igual que en tags/elecciones: si hay actor se abre la transaccion con el
 * contexto de auditoria, si no una transaccion normal.
 */
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

// ============================================
// VALIDACION
// ============================================

function normalizeTitle(title?: string | null): string {
  const normalized = normalizeText(title);
  if (!normalized) {
    throw badRequest('APPLICATION_FORM_TITLE_REQUIRED', 'El formulario necesita un título');
  }
  if (normalized.length > 200) {
    throw badRequest(
      'APPLICATION_FORM_TITLE_TOO_LONG',
      'El título del formulario no puede pasar de 200 caracteres'
    );
  }
  return normalized;
}

function parseDate(value: string | null | undefined, label: string): Date | null {
  if (value === null || value === undefined || value === '') return null;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw badRequest('APPLICATION_FORM_INVALID_DATE', `La fecha de ${label} no es válida`);
  }
  return parsed;
}

function validateWindow(startTime: Date | null, endTime: Date | null) {
  if (startTime && endTime && endTime.getTime() <= startTime.getTime()) {
    throw badRequest(
      'APPLICATION_FORM_INVALID_WINDOW',
      'La fecha de cierre debe ser posterior a la de apertura'
    );
  }
}

function validateVoterSource(source: unknown): VoterSource {
  if (typeof source !== 'string' || !VOTER_SOURCES.includes(source as VoterSource)) {
    throw badRequest(
      'APPLICATION_FORM_INVALID_AUDIENCE',
      'Selecciona a quién va dirigido el formulario'
    );
  }
  return source as VoterSource;
}

/**
 * Calcula el estado inicial a partir de la ventana de tiempo, igual que hacen
 * las elecciones: un formulario publicado con fecha futura queda SCHEDULED.
 */
function resolveFormStatus(
  requested: ApplicationFormStatus | undefined,
  startTime: Date | null,
  endTime: Date | null,
  now: Date = new Date()
): ApplicationFormStatus {
  if (requested === 'DRAFT' || requested === 'ARCHIVED') {
    return requested;
  }

  if (endTime && endTime.getTime() <= now.getTime()) return 'CLOSED';
  if (startTime && startTime.getTime() > now.getTime()) return 'SCHEDULED';
  return 'OPEN';
}

// ============================================
// FORMULARIOS
// ============================================

export async function listForms(): Promise<ApplicationFormWithStats[]> {
  await repo.syncAutomaticStatuses();
  return repo.findAllForms();
}

export async function getForm(id: string): Promise<ApplicationFormWithStats> {
  await repo.syncAutomaticStatuses();

  const form = await repo.findFormById(id);
  if (!form) {
    throw notFound('APPLICATION_FORM_NOT_FOUND', 'Formulario de postulación no encontrado');
  }
  return form;
}

/**
 * Rellena `application_form_eligibility` segun la audiencia elegida.
 * Es el mismo switch que usa electionService para poblar `election_voters`.
 */
async function populateEligibility(
  formId: string,
  data: { voter_source: VoterSource; voter_filter?: { sede?: string; career?: string } | null; tag_id?: string | null; student_ids?: string[] },
  client?: PoolClient
): Promise<number> {
  switch (data.voter_source) {
    case 'TAG': {
      if (!data.tag_id) {
        throw badRequest('APPLICATION_FORM_TAG_REQUIRED', 'Se necesita una tag para definir la audiencia');
      }
      return repo.populateEligibilityFromTag(formId, data.tag_id, client);
    }
    case 'MANUAL':
      return repo.populateEligibilityManual(formId, data.student_ids ?? [], client);
    case 'FILTERED': {
      const sede = normalizeText(data.voter_filter?.sede) ?? undefined;
      const career = normalizeText(data.voter_filter?.career) ?? undefined;

      if (!sede && !career) {
        throw badRequest(
          'APPLICATION_FORM_FILTER_REQUIRED',
          'Elige al menos una sede o una carrera para filtrar la audiencia'
        );
      }
      return repo.populateEligibilityFromPadron(formId, { sede, career }, client);
    }
    case 'FULL_PADRON':
    default:
      return repo.populateEligibilityFromPadron(formId, undefined, client);
  }
}

export async function createForm(
  data: CreateApplicationFormDto,
  actor?: AuditActor
): Promise<ApplicationFormWithStats> {
  const title = normalizeTitle(data.title);
  const voterSource = validateVoterSource(data.voter_source);
  const startTime = parseDate(data.start_time, 'apertura');
  const endTime = parseDate(data.end_time, 'cierre');
  validateWindow(startTime, endTime);

  const status = resolveFormStatus(data.status, startTime, endTime);

  const created = await withOptionalAudit(actor, async (client) => {
    const form = await repo.insertForm(
      {
        ...data,
        title,
        description: normalizeText(data.description),
        voter_source: voterSource,
        voter_filter:
          voterSource === 'FILTERED'
            ? {
                sede: normalizeText(data.voter_filter?.sede) ?? undefined,
                career: normalizeText(data.voter_filter?.career) ?? undefined,
              }
            : null,
        tag_id: voterSource === 'TAG' ? data.tag_id ?? null : null,
        other_documents_label: data.allow_other_documents
          ? normalizeText(data.other_documents_label)
          : null,
        start_time: startTime ? startTime.toISOString() : null,
        end_time: endTime ? endTime.toISOString() : null,
        status,
      },
      actor?.id ?? null,
      client
    );

    const eligible = await populateEligibility(
      form.id,
      { ...data, voter_source: voterSource },
      client
    );

    // Un formulario publicado sin destinatarios no le sirve a nadie y es
    // casi siempre un filtro mal escrito.
    if (status !== 'DRAFT' && eligible === 0) {
      throw badRequest(
        'APPLICATION_FORM_NO_ELIGIBLE_STUDENTS',
        'La audiencia seleccionada no incluye a ningún estudiante activo'
      );
    }

    return form;
  });

  return getForm(created.id);
}

export async function updateForm(
  id: string,
  data: UpdateApplicationFormDto,
  actor?: AuditActor
): Promise<ApplicationFormWithStats> {
  const existing = await repo.findFormRawById(id);
  if (!existing) {
    throw notFound('APPLICATION_FORM_NOT_FOUND', 'Formulario de postulación no encontrado');
  }

  const audienceChanged =
    data.voter_source !== undefined ||
    data.voter_filter !== undefined ||
    data.tag_id !== undefined ||
    data.student_ids !== undefined;

  // Cambiar la audiencia repuebla la elegibilidad; si ya hay respuestas,
  // eso dejaria postulaciones huerfanas de gente que ya no es elegible.
  if (audienceChanged) {
    const applications = await repo.findApplicationsByForm(id);
    if (applications.length > 0) {
      throw conflict(
        'APPLICATION_FORM_HAS_RESPONSES',
        'No se puede cambiar la audiencia de un formulario que ya tiene postulaciones'
      );
    }
  }

  const startTime =
    data.start_time !== undefined
      ? parseDate(data.start_time, 'apertura')
      : existing.start_time
        ? new Date(existing.start_time)
        : null;
  const endTime =
    data.end_time !== undefined
      ? parseDate(data.end_time, 'cierre')
      : existing.end_time
        ? new Date(existing.end_time)
        : null;
  validateWindow(startTime, endTime);

  const voterSource = data.voter_source
    ? validateVoterSource(data.voter_source)
    : existing.voter_source;

  await withOptionalAudit(actor, async (client) => {
    await repo.updateForm(
      id,
      {
        ...data,
        title: data.title !== undefined ? normalizeTitle(data.title) : undefined,
        description: data.description !== undefined ? normalizeText(data.description) : undefined,
        start_time: data.start_time !== undefined ? (startTime ? startTime.toISOString() : null) : undefined,
        end_time: data.end_time !== undefined ? (endTime ? endTime.toISOString() : null) : undefined,
        voter_source: data.voter_source !== undefined ? voterSource : undefined,
        voter_filter:
          data.voter_filter !== undefined
            ? voterSource === 'FILTERED'
              ? {
                  sede: normalizeText(data.voter_filter?.sede) ?? undefined,
                  career: normalizeText(data.voter_filter?.career) ?? undefined,
                }
              : null
            : undefined,
        tag_id: data.tag_id !== undefined ? (voterSource === 'TAG' ? data.tag_id : null) : undefined,
        other_documents_label:
          data.other_documents_label !== undefined
            ? normalizeText(data.other_documents_label)
            : undefined,
        status:
          data.status !== undefined
            ? resolveFormStatus(data.status, startTime, endTime)
            : undefined,
      },
      client
    );

    if (audienceChanged) {
      await repo.clearEligibility(id, client);
      await populateEligibility(
        id,
        {
          voter_source: voterSource,
          voter_filter: data.voter_filter ?? (existing.voter_filter as { sede?: string; career?: string } | null),
          tag_id: data.tag_id ?? existing.tag_id,
          student_ids: data.student_ids,
        },
        client
      );
    }
  });

  return getForm(id);
}

export async function deleteForm(id: string, actor?: AuditActor): Promise<void> {
  const existing = await repo.findFormRawById(id);
  if (!existing) {
    throw notFound('APPLICATION_FORM_NOT_FOUND', 'Formulario de postulación no encontrado');
  }

  await withOptionalAudit(actor, async (client) => {
    await repo.deleteForm(id, client);
  });
}

// ============================================
// RESPUESTAS
// ============================================

export async function listApplications(
  formId: string,
  status?: string
): Promise<ApplicationSummary[]> {
  await getForm(formId);

  if (status !== undefined && !APPLICATION_STATUSES.includes(status as ApplicationStatus)) {
    throw badRequest('APPLICATION_INVALID_STATUS', 'El estado solicitado no existe');
  }

  return repo.findApplicationsByForm(formId, status as ApplicationStatus | undefined);
}

export async function getApplication(id: string): Promise<ApplicationDetail> {
  const detail = await repo.buildApplicationDetail(id);
  if (!detail) {
    throw notFound('APPLICATION_NOT_FOUND', 'Postulación no encontrada');
  }
  return detail;
}

/**
 * Resuelve una postulación.
 *
 * Aprobado y Denegado la cierran; Condicionado la reabre solo en los campos
 * que el admin marcó y con un plazo propio de corrección, independiente del
 * cierre del formulario.
 */
export async function reviewApplication(
  id: string,
  data: ReviewApplicationDto,
  actor?: AuditActor
): Promise<ApplicationDetail> {
  const application = await repo.findApplicationById(id);
  if (!application) {
    throw notFound('APPLICATION_NOT_FOUND', 'Postulación no encontrada');
  }

  if (!['APPROVED', 'CONDITIONED', 'REJECTED'].includes(data.decision)) {
    throw badRequest(
      'APPLICATION_INVALID_DECISION',
      'La decisión debe ser Aprobado, Condicionado o Denegado'
    );
  }

  // Solo tiene sentido resolver algo que el estudiante ya envió.
  if (application.status === 'DRAFT') {
    throw conflict(
      'APPLICATION_NOT_SUBMITTED',
      'Esta postulación todavía no ha sido enviada por el estudiante'
    );
  }

  const unlockedFields =
    data.decision === 'CONDITIONED' ? normalizeUnlockedFields(data.unlocked_fields) : [];

  if (data.decision === 'CONDITIONED' && unlockedFields.length === 0) {
    throw badRequest(
      'APPLICATION_NO_UNLOCKED_FIELDS',
      'Marca al menos un campo para que el estudiante pueda corregir'
    );
  }

  let correctionDeadline: Date | null = null;
  if (data.decision === 'CONDITIONED') {
    correctionDeadline = parseDate(data.correction_deadline, 'corrección');

    if (!correctionDeadline) {
      throw badRequest(
        'APPLICATION_DEADLINE_REQUIRED',
        'Indica hasta cuándo puede corregir el estudiante'
      );
    }
    if (correctionDeadline.getTime() <= Date.now()) {
      throw badRequest(
        'APPLICATION_DEADLINE_IN_PAST',
        'El plazo de corrección debe ser una fecha futura'
      );
    }
  }

  await withOptionalAudit(actor, async (client) => {
    const payload = {
      decision: data.decision,
      comment: normalizeText(data.comment),
      unlocked_fields: unlockedFields,
      correction_deadline: correctionDeadline ? correctionDeadline.toISOString() : null,
      reviewerId: actor?.id ?? null,
    };

    await repo.applyReview(id, payload, client);
    await repo.insertReview(id, payload, client);
  });

  return getApplication(id);
}

// ============================================
// ADJUNTOS
// ============================================

export async function getFileForAdmin(fileId: string): Promise<ApplicationFileContent> {
  const file = await repo.findFileWithContent(fileId);
  if (!file) {
    throw notFound('APPLICATION_FILE_NOT_FOUND', 'Archivo no encontrado');
  }
  return file;
}
