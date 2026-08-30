import { Pool, PoolClient } from 'pg';
import { pool } from '../../../config/database';
import {
  Application,
  ApplicationDetail,
  ApplicationFileContent,
  ApplicationFileMeta,
  ApplicationForm,
  ApplicationFormWithStats,
  ApplicationPosition,
  ApplicationPositionWithUsage,
  ApplicationReview,
  ApplicationSummary,
  ApplicationStatus,
  CreateApplicationFormDto,
  MyApplicationFormSummary,
  ReviewApplicationDto,
  SaveApplicationDto,
  UpdateApplicationFormDto,
} from '../models/postulacionModel';
import { FileFieldKey } from '../constants/applicationFields';

type Queryable = Pool | PoolClient;

/**
 * Recalcula los estados que dependen solo del reloj, igual que
 * `syncAutomaticStatuses` de elecciones. Se llama al inicio de cada lectura
 * para que un formulario programado se abra o cierre solo.
 */
export async function syncAutomaticStatuses(db: Queryable = pool): Promise<void> {
  await db.query(
    `UPDATE application_forms
     SET status = CASE
       WHEN end_time IS NOT NULL AND end_time <= now() THEN 'CLOSED'::application_form_status
       WHEN (start_time IS NULL OR start_time <= now()) AND (end_time IS NULL OR end_time > now()) THEN 'OPEN'::application_form_status
       WHEN start_time > now() THEN 'SCHEDULED'::application_form_status
       ELSE status
     END
     WHERE status IN ('SCHEDULED', 'OPEN')
       AND (
         (end_time IS NOT NULL AND end_time <= now() AND status <> 'CLOSED')
         OR ((start_time IS NULL OR start_time <= now()) AND (end_time IS NULL OR end_time > now()) AND status <> 'OPEN')
         OR (start_time > now() AND status <> 'SCHEDULED')
       )`
  );
}

// ============================================
// FORMULARIOS
// ============================================

const FORM_STATS_SELECT = `
  SELECT f.*,
    t.name AS tag_name,
    t.color AS tag_color,
    e.title AS election_title,
    COALESCE(pos.positions, '[]'::jsonb) AS positions,
    COALESCE(el.eligible_count, 0)::int AS eligible_count,
    COALESCE(ap.submitted_count, 0)::int AS submitted_count,
    COALESCE(ap.approved_count, 0)::int AS approved_count,
    COALESCE(ap.conditioned_count, 0)::int AS conditioned_count,
    COALESCE(ap.rejected_count, 0)::int AS rejected_count,
    COALESCE(ap.draft_count, 0)::int AS draft_count
  FROM application_forms f
  LEFT JOIN tags t ON t.id = f.tag_id
  LEFT JOIN elections e ON e.id = f.election_id
  LEFT JOIN (
    SELECT form_id, count(*) AS eligible_count
    FROM application_form_eligibility GROUP BY form_id
  ) el ON el.form_id = f.id
  LEFT JOIN (
    SELECT form_id, jsonb_agg(p ORDER BY p.display_order, p.name) AS positions
    FROM application_positions p GROUP BY form_id
  ) pos ON pos.form_id = f.id
  LEFT JOIN (
    SELECT form_id,
      count(*) FILTER (WHERE status = 'SUBMITTED')   AS submitted_count,
      count(*) FILTER (WHERE status = 'APPROVED')    AS approved_count,
      count(*) FILTER (WHERE status = 'CONDITIONED') AS conditioned_count,
      count(*) FILTER (WHERE status = 'REJECTED')    AS rejected_count,
      count(*) FILTER (WHERE status = 'DRAFT')       AS draft_count
    FROM applications GROUP BY form_id
  ) ap ON ap.form_id = f.id
`;

export async function findAllForms(db: Queryable = pool): Promise<ApplicationFormWithStats[]> {
  const result = await db.query<ApplicationFormWithStats>(
    `${FORM_STATS_SELECT} ORDER BY f.created_at DESC`
  );
  return result.rows;
}

export async function findFormById(
  id: string,
  db: Queryable = pool
): Promise<ApplicationFormWithStats | null> {
  const result = await db.query<ApplicationFormWithStats>(
    `${FORM_STATS_SELECT} WHERE f.id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

export async function insertForm(
  data: CreateApplicationFormDto & { status: ApplicationForm['status'] },
  createdBy?: string | null,
  db: Queryable = pool
): Promise<ApplicationForm> {
  const result = await db.query<ApplicationForm>(
    `INSERT INTO application_forms
       (title, description, status, start_time, end_time, allow_other_documents,
        other_documents_label, voter_source, voter_filter, tag_id, election_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      data.title,
      data.description ?? null,
      data.status,
      data.start_time ?? null,
      data.end_time ?? null,
      data.allow_other_documents ?? false,
      data.other_documents_label ?? null,
      data.voter_source,
      data.voter_filter ? JSON.stringify(data.voter_filter) : null,
      data.tag_id ?? null,
      data.election_id ?? null,
      createdBy ?? null,
    ]
  );
  return result.rows[0];
}

export async function updateForm(
  id: string,
  data: UpdateApplicationFormDto & { status?: ApplicationForm['status'] },
  db: Queryable = pool
): Promise<ApplicationForm | null> {
  const fields: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  const assign = (column: string, value: unknown) => {
    fields.push(`${column} = $${idx++}`);
    params.push(value);
  };

  if (data.title !== undefined) assign('title', data.title);
  if (data.description !== undefined) assign('description', data.description);
  if (data.status !== undefined) assign('status', data.status);
  if (data.start_time !== undefined) assign('start_time', data.start_time);
  if (data.end_time !== undefined) assign('end_time', data.end_time);
  if (data.allow_other_documents !== undefined) {
    assign('allow_other_documents', data.allow_other_documents);
  }
  if (data.other_documents_label !== undefined) {
    assign('other_documents_label', data.other_documents_label);
  }
  if (data.voter_source !== undefined) assign('voter_source', data.voter_source);
  if (data.voter_filter !== undefined) {
    assign('voter_filter', data.voter_filter ? JSON.stringify(data.voter_filter) : null);
  }
  if (data.tag_id !== undefined) assign('tag_id', data.tag_id);
  if (data.election_id !== undefined) assign('election_id', data.election_id);

  if (fields.length === 0) {
    return findFormRawById(id, db);
  }

  params.push(id);
  const result = await db.query<ApplicationForm>(
    `UPDATE application_forms SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    params
  );
  return result.rows[0] || null;
}

export async function findFormRawById(
  id: string,
  db: Queryable = pool
): Promise<ApplicationForm | null> {
  const result = await db.query<ApplicationForm>(
    'SELECT * FROM application_forms WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

export async function deleteForm(id: string, db: Queryable = pool): Promise<boolean> {
  const result = await db.query('DELETE FROM application_forms WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

// ============================================
// PUESTOS
//
// Se pueden editar en cualquier momento, incluso con el formulario abierto
// y con respuestas dentro.
// ============================================

export async function findPositionsByForm(
  formId: string,
  db: Queryable = pool
): Promise<ApplicationPosition[]> {
  const result = await db.query<ApplicationPosition>(
    `SELECT * FROM application_positions
     WHERE form_id = $1
     ORDER BY display_order ASC, name ASC`,
    [formId]
  );
  return result.rows;
}

/** Igual que el anterior, pero contando cuánta gente eligió cada puesto. */
export async function findPositionsWithUsage(
  formId: string,
  db: Queryable = pool
): Promise<ApplicationPositionWithUsage[]> {
  const result = await db.query<ApplicationPositionWithUsage>(
    `SELECT p.*, COALESCE(a.total, 0)::int AS application_count
     FROM application_positions p
     LEFT JOIN (
       SELECT position_id, count(*) AS total
       FROM applications WHERE position_id IS NOT NULL GROUP BY position_id
     ) a ON a.position_id = p.id
     WHERE p.form_id = $1
     ORDER BY p.display_order ASC, p.name ASC`,
    [formId]
  );
  return result.rows;
}

export async function findPositionById(
  positionId: string,
  db: Queryable = pool
): Promise<ApplicationPosition | null> {
  const result = await db.query<ApplicationPosition>(
    'SELECT * FROM application_positions WHERE id = $1',
    [positionId]
  );
  return result.rows[0] || null;
}

export async function insertPosition(
  formId: string,
  name: string,
  db: Queryable = pool
): Promise<ApplicationPosition> {
  // El orden por defecto deja el puesto nuevo al final de la lista.
  const result = await db.query<ApplicationPosition>(
    `INSERT INTO application_positions (form_id, name, display_order)
     VALUES ($1, $2, COALESCE(
       (SELECT max(display_order) + 1 FROM application_positions WHERE form_id = $1), 0
     ))
     RETURNING *`,
    [formId, name]
  );
  return result.rows[0];
}

export async function updatePositionName(
  positionId: string,
  name: string,
  db: Queryable = pool
): Promise<ApplicationPosition | null> {
  const result = await db.query<ApplicationPosition>(
    'UPDATE application_positions SET name = $1 WHERE id = $2 RETURNING *',
    [name, positionId]
  );
  return result.rows[0] || null;
}

export async function deletePosition(
  positionId: string,
  db: Queryable = pool
): Promise<boolean> {
  const result = await db.query('DELETE FROM application_positions WHERE id = $1', [positionId]);
  return (result.rowCount ?? 0) > 0;
}

export async function countApplicationsByPosition(
  positionId: string,
  db: Queryable = pool
): Promise<number> {
  const result = await db.query<{ total: string }>(
    'SELECT count(*) AS total FROM applications WHERE position_id = $1',
    [positionId]
  );
  return parseInt(result.rows[0]?.total ?? '0', 10);
}

// ============================================
// ELEGIBILIDAD
// ============================================

export async function clearEligibility(formId: string, db: Queryable = pool): Promise<void> {
  await db.query('DELETE FROM application_form_eligibility WHERE form_id = $1', [formId]);
}

export async function populateEligibilityFromPadron(
  formId: string,
  filters?: { sede?: string; career?: string },
  db: Queryable = pool
): Promise<number> {
  const conditions: string[] = ['is_active = true'];
  const params: unknown[] = [formId];
  let idx = 2;

  if (filters?.sede) {
    conditions.push(`sede ILIKE $${idx++}`);
    params.push(filters.sede);
  }
  if (filters?.career) {
    conditions.push(`career ILIKE $${idx++}`);
    params.push(filters.career);
  }

  const result = await db.query(
    `INSERT INTO application_form_eligibility (form_id, student_id)
     SELECT $1, id FROM students WHERE ${conditions.join(' AND ')}
     ON CONFLICT (form_id, student_id) DO NOTHING`,
    params
  );
  return result.rowCount ?? 0;
}

export async function populateEligibilityFromTag(
  formId: string,
  tagId: string,
  db: Queryable = pool
): Promise<number> {
  const result = await db.query(
    `INSERT INTO application_form_eligibility (form_id, student_id)
     SELECT $1, s.id
     FROM tag_members tm
     INNER JOIN students s ON s.id = tm.student_id
     WHERE tm.tag_id = $2 AND s.is_active = true
     ON CONFLICT (form_id, student_id) DO NOTHING`,
    [formId, tagId]
  );
  return result.rowCount ?? 0;
}

export async function populateEligibilityManual(
  formId: string,
  studentIds: string[],
  db: Queryable = pool
): Promise<number> {
  if (studentIds.length === 0) return 0;

  const result = await db.query(
    `INSERT INTO application_form_eligibility (form_id, student_id)
     SELECT $1, unnest($2::uuid[])
     ON CONFLICT (form_id, student_id) DO NOTHING`,
    [formId, studentIds]
  );
  return result.rowCount ?? 0;
}

export async function countEligibility(formId: string, db: Queryable = pool): Promise<number> {
  const result = await db.query<{ total: string }>(
    'SELECT count(*) AS total FROM application_form_eligibility WHERE form_id = $1',
    [formId]
  );
  return parseInt(result.rows[0]?.total ?? '0', 10);
}

export async function isStudentEligible(
  formId: string,
  studentId: string,
  db: Queryable = pool
): Promise<boolean> {
  const result = await db.query(
    'SELECT 1 FROM application_form_eligibility WHERE form_id = $1 AND student_id = $2',
    [formId, studentId]
  );
  return (result.rowCount ?? 0) > 0;
}

// ============================================
// POSTULACIONES
// ============================================

const APPLICATION_SUMMARY_SELECT = `
  SELECT a.*,
    s.full_name AS student_full_name,
    s.carnet    AS student_carnet,
    s.email     AS student_email,
    p.name      AS position_name,
    COALESCE(fc.files_count, 0)::int AS files_count
  FROM applications a
  INNER JOIN students s ON s.id = a.student_id
  LEFT JOIN application_positions p ON p.id = a.position_id
  LEFT JOIN (
    SELECT application_id, count(*) AS files_count
    FROM application_files GROUP BY application_id
  ) fc ON fc.application_id = a.id
`;

export async function findApplicationsByForm(
  formId: string,
  status?: ApplicationStatus,
  db: Queryable = pool
): Promise<ApplicationSummary[]> {
  const params: unknown[] = [formId];
  let where = 'WHERE a.form_id = $1';

  if (status) {
    params.push(status);
    where += ' AND a.status = $2';
  }

  // Los borradores no enviados no le sirven al admin para revisar, pero se
  // devuelven igual para que pueda ver quien empezo y no termino.
  const result = await db.query<ApplicationSummary>(
    `${APPLICATION_SUMMARY_SELECT} ${where}
     ORDER BY
       CASE a.status
         WHEN 'SUBMITTED' THEN 0
         WHEN 'CONDITIONED' THEN 1
         WHEN 'APPROVED' THEN 2
         WHEN 'REJECTED' THEN 3
         ELSE 4
       END,
       a.submitted_at DESC NULLS LAST,
       s.full_name ASC`,
    params
  );
  return result.rows;
}

export async function findApplicationById(
  id: string,
  db: Queryable = pool
): Promise<ApplicationSummary | null> {
  const result = await db.query<ApplicationSummary>(
    `${APPLICATION_SUMMARY_SELECT} WHERE a.id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

export async function findApplicationByStudent(
  formId: string,
  studentId: string,
  db: Queryable = pool
): Promise<Application | null> {
  const result = await db.query<Application>(
    'SELECT * FROM applications WHERE form_id = $1 AND student_id = $2',
    [formId, studentId]
  );
  return result.rows[0] || null;
}

export async function insertApplication(
  formId: string,
  studentId: string,
  email: string,
  db: Queryable = pool
): Promise<Application> {
  const result = await db.query<Application>(
    `INSERT INTO applications (form_id, student_id, status, email)
     VALUES ($1, $2, 'DRAFT', $3)
     ON CONFLICT (form_id, student_id) DO UPDATE SET form_id = EXCLUDED.form_id
     RETURNING *`,
    [formId, studentId, email]
  );
  return result.rows[0];
}

/**
 * Guarda los campos de datos del postulante.
 *
 * `data` ya viene filtrado por el service: solo trae los campos que el
 * estudiante tiene permitido escribir en este momento.
 */
export async function updateApplicationData(
  id: string,
  data: SaveApplicationDto,
  db: Queryable = pool
): Promise<Application | null> {
  const allowedColumns = [
    'last_name_1',
    'last_name_2',
    'first_name',
    'national_id',
    'carnet',
    'phone',
    'sede',
    'career',
    'position_id',
  ] as const;

  const fields: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  for (const column of allowedColumns) {
    if (data[column] !== undefined) {
      fields.push(`${column} = $${idx++}`);
      params.push(data[column]);
    }
  }

  if (fields.length === 0) {
    const current = await db.query<Application>('SELECT * FROM applications WHERE id = $1', [id]);
    return current.rows[0] || null;
  }

  params.push(id);
  const result = await db.query<Application>(
    `UPDATE applications SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    params
  );
  return result.rows[0] || null;
}

export async function markApplicationSubmitted(
  id: string,
  db: Queryable = pool
): Promise<Application | null> {
  const result = await db.query<Application>(
    `UPDATE applications
     SET status = 'SUBMITTED',
         submitted_at = now(),
         unlocked_fields = NULL,
         correction_deadline = NULL
     WHERE id = $1
     RETURNING *`,
    [id]
  );
  return result.rows[0] || null;
}

export async function applyReview(
  id: string,
  data: ReviewApplicationDto & { reviewerId?: string | null },
  db: Queryable = pool
): Promise<Application | null> {
  const isConditioned = data.decision === 'CONDITIONED';

  const result = await db.query<Application>(
    `UPDATE applications
     SET status = $1::application_status,
         review_comment = $2,
         unlocked_fields = $3::jsonb,
         correction_deadline = $4,
         reviewed_by = $5,
         reviewed_at = now()
     WHERE id = $6
     RETURNING *`,
    [
      data.decision,
      data.comment ?? null,
      isConditioned ? JSON.stringify(data.unlocked_fields ?? []) : null,
      isConditioned ? data.correction_deadline ?? null : null,
      data.reviewerId ?? null,
      id,
    ]
  );
  return result.rows[0] || null;
}

export async function insertReview(
  applicationId: string,
  data: ReviewApplicationDto & { reviewerId?: string | null },
  db: Queryable = pool
): Promise<ApplicationReview> {
  const result = await db.query<ApplicationReview>(
    `INSERT INTO application_reviews
       (application_id, reviewer_id, decision, comment, unlocked_fields, correction_deadline)
     VALUES ($1, $2, $3::application_status, $4, $5::jsonb, $6)
     RETURNING *`,
    [
      applicationId,
      data.reviewerId ?? null,
      data.decision,
      data.comment ?? null,
      data.decision === 'CONDITIONED' ? JSON.stringify(data.unlocked_fields ?? []) : null,
      data.decision === 'CONDITIONED' ? data.correction_deadline ?? null : null,
    ]
  );
  return result.rows[0];
}

export async function findReviewsByApplication(
  applicationId: string,
  db: Queryable = pool
): Promise<ApplicationReview[]> {
  const result = await db.query<ApplicationReview>(
    `SELECT r.*, s.full_name AS reviewer_name
     FROM application_reviews r
     LEFT JOIN students s ON s.id = r.reviewer_id
     WHERE r.application_id = $1
     ORDER BY r.created_at DESC`,
    [applicationId]
  );
  return result.rows;
}

// ============================================
// ADJUNTOS
//
// Ninguna consulta de listado selecciona `content`: traer los binarios de
// 5 archivos por postulante reventaria la memoria de la funcion serverless.
// ============================================

const FILE_META_COLUMNS =
  'id, application_id, field_key, file_name, mime_type, size_bytes, uploaded_at';

export async function findFilesByApplication(
  applicationId: string,
  db: Queryable = pool
): Promise<ApplicationFileMeta[]> {
  const result = await db.query<ApplicationFileMeta>(
    `SELECT ${FILE_META_COLUMNS} FROM application_files
     WHERE application_id = $1
     ORDER BY field_key ASC, uploaded_at ASC`,
    [applicationId]
  );
  return result.rows;
}

export async function findFileWithContent(
  fileId: string,
  db: Queryable = pool
): Promise<ApplicationFileContent | null> {
  const result = await db.query<ApplicationFileContent>(
    `SELECT ${FILE_META_COLUMNS}, content FROM application_files WHERE id = $1`,
    [fileId]
  );
  return result.rows[0] || null;
}

export async function findFileMeta(
  fileId: string,
  db: Queryable = pool
): Promise<ApplicationFileMeta | null> {
  const result = await db.query<ApplicationFileMeta>(
    `SELECT ${FILE_META_COLUMNS} FROM application_files WHERE id = $1`,
    [fileId]
  );
  return result.rows[0] || null;
}

export async function upsertFile(
  applicationId: string,
  fieldKey: FileFieldKey,
  file: { fileName: string; mimeType: string; content: Buffer },
  db: Queryable = pool
): Promise<ApplicationFileMeta> {
  // Los campos fijos admiten un solo archivo: se reemplaza el anterior.
  // `other` acumula, asi que nunca se borra nada al subir.
  if (fieldKey !== 'other') {
    await db.query(
      'DELETE FROM application_files WHERE application_id = $1 AND field_key = $2',
      [applicationId, fieldKey]
    );
  }

  const result = await db.query<ApplicationFileMeta>(
    `INSERT INTO application_files
       (application_id, field_key, file_name, mime_type, size_bytes, content)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${FILE_META_COLUMNS}`,
    [applicationId, fieldKey, file.fileName, file.mimeType, file.content.length, file.content]
  );
  return result.rows[0];
}

export async function deleteFile(fileId: string, db: Queryable = pool): Promise<boolean> {
  const result = await db.query('DELETE FROM application_files WHERE id = $1', [fileId]);
  return (result.rowCount ?? 0) > 0;
}

export async function buildApplicationDetail(
  applicationId: string,
  db: Queryable = pool
): Promise<ApplicationDetail | null> {
  const application = await findApplicationById(applicationId, db);
  if (!application) return null;

  const [files, reviews] = await Promise.all([
    findFilesByApplication(applicationId, db),
    findReviewsByApplication(applicationId, db),
  ]);

  return { ...application, files, reviews };
}

// ============================================
// VISTA DEL ESTUDIANTE
// ============================================

/**
 * Formularios en los que este estudiante es elegible, con el estado de su
 * propia postulación. Se incluyen los cerrados solo si ya participó, para
 * que pueda seguir consultando el resultado.
 */
export async function findFormsForStudent(
  studentId: string,
  db: Queryable = pool
): Promise<MyApplicationFormSummary[]> {
  const result = await db.query<MyApplicationFormSummary>(
    `SELECT f.id, f.title, f.description, f.status, f.start_time, f.end_time,
            f.allow_other_documents, f.other_documents_label,
            a.status AS application_status,
            a.submitted_at,
            a.correction_deadline,
            a.review_comment,
            false AS can_edit
     FROM application_forms f
     INNER JOIN application_form_eligibility el
       ON el.form_id = f.id AND el.student_id = $1
     LEFT JOIN applications a
       ON a.form_id = f.id AND a.student_id = $1
     WHERE f.status IN ('OPEN', 'CLOSED')
       AND (f.status = 'OPEN' OR a.id IS NOT NULL)
     ORDER BY
       CASE f.status WHEN 'OPEN' THEN 0 ELSE 1 END,
       f.end_time ASC NULLS LAST,
       f.created_at DESC`,
    [studentId]
  );
  return result.rows;
}
