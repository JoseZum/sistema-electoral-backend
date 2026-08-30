import { ApplicationFieldKey, FileFieldKey } from '../constants/applicationFields';

export type ApplicationFormStatus = 'DRAFT' | 'SCHEDULED' | 'OPEN' | 'CLOSED' | 'ARCHIVED';

export type ApplicationStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'CONDITIONED'
  | 'REJECTED';

/** Decisiones que puede tomar el admin al revisar. */
export type ReviewDecision = Extract<
  ApplicationStatus,
  'APPROVED' | 'CONDITIONED' | 'REJECTED'
>;

export type VoterSource = 'FULL_PADRON' | 'FILTERED' | 'MANUAL' | 'TAG';

/** Puesto al que se puede presentar un postulante. Solo tiene nombre. */
export interface ApplicationPosition {
  id: string;
  form_id: string;
  name: string;
  display_order: number;
  created_at: string;
  updated_at: string;
}

/** Puesto con el conteo de postulantes, para avisar antes de borrarlo. */
export interface ApplicationPositionWithUsage extends ApplicationPosition {
  application_count: number;
}

export interface ApplicationForm {
  id: string;
  title: string;
  description: string | null;
  status: ApplicationFormStatus;
  start_time: string | null;
  end_time: string | null;
  allow_other_documents: boolean;
  other_documents_label: string | null;
  voter_source: VoterSource;
  voter_filter: Record<string, unknown> | null;
  tag_id: string | null;
  election_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApplicationFormWithStats extends ApplicationForm {
  tag_name: string | null;
  tag_color: string | null;
  election_title: string | null;
  positions: ApplicationPosition[];
  eligible_count: number;
  submitted_count: number;
  approved_count: number;
  conditioned_count: number;
  rejected_count: number;
  draft_count: number;
}

export interface Application {
  id: string;
  form_id: string;
  student_id: string;
  status: ApplicationStatus;
  last_name_1: string | null;
  last_name_2: string | null;
  first_name: string | null;
  email: string | null;
  national_id: string | null;
  carnet: string | null;
  phone: string | null;
  sede: string | null;
  career: string | null;
  position_id: string | null;
  unlocked_fields: ApplicationFieldKey[] | null;
  correction_deadline: string | null;
  review_comment: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Metadatos de un adjunto. Nunca incluye la columna `content`. */
export interface ApplicationFileMeta {
  id: string;
  application_id: string;
  field_key: FileFieldKey;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_at: string;
}

export interface ApplicationFileContent extends ApplicationFileMeta {
  content: Buffer;
}

export interface ApplicationReview {
  id: string;
  application_id: string;
  reviewer_id: string | null;
  reviewer_name: string | null;
  decision: ReviewDecision;
  comment: string | null;
  unlocked_fields: ApplicationFieldKey[] | null;
  correction_deadline: string | null;
  created_at: string;
}

/** Fila de la tabla de respuestas que ve el admin. */
export interface ApplicationSummary extends Application {
  student_full_name: string;
  student_carnet: string;
  student_email: string;
  position_name: string | null;
  files_count: number;
}

export interface ApplicationDetail extends ApplicationSummary {
  files: ApplicationFileMeta[];
  reviews: ApplicationReview[];
}

// ============================================
// DTOs
// ============================================

export interface CreateApplicationFormDto {
  title: string;
  description?: string | null;
  status?: ApplicationFormStatus;
  start_time?: string | null;
  end_time?: string | null;
  allow_other_documents?: boolean;
  other_documents_label?: string | null;
  voter_source: VoterSource;
  voter_filter?: { sede?: string; career?: string } | null;
  tag_id?: string | null;
  election_id?: string | null;
  student_ids?: string[];
  /** Nombres de los puestos a crear junto con el formulario. */
  positions?: string[];
}

export type UpdateApplicationFormDto = Partial<CreateApplicationFormDto>;

export interface CreatePositionDto {
  name: string;
}

export type UpdatePositionDto = CreatePositionDto;

export interface ReviewApplicationDto {
  decision: ReviewDecision;
  comment?: string | null;
  unlocked_fields?: string[];
  correction_deadline?: string | null;
}

/** Datos que el estudiante guarda en su borrador. */
export type SaveApplicationDto = Partial<
  Record<
    | 'last_name_1'
    | 'last_name_2'
    | 'first_name'
    | 'national_id'
    | 'carnet'
    | 'phone'
    | 'sede'
    | 'career'
    | 'position_id',
    string | null
  >
>;

/** Sugerencias derivadas del padrón para prellenar el formulario. */
export interface ApplicationPrefill {
  last_name_1: string;
  last_name_2: string;
  first_name: string;
  email: string;
  national_id: string;
  carnet: string;
  sede: string;
  career: string;
  /** Campos que el estudiante no puede alterar (hoy: solo el correo). */
  locked_fields: ApplicationFieldKey[];
}

/** Vista del formulario desde el lado del estudiante. */
export interface MyApplicationFormSummary {
  id: string;
  title: string;
  description: string | null;
  status: ApplicationFormStatus;
  start_time: string | null;
  end_time: string | null;
  allow_other_documents: boolean;
  other_documents_label: string | null;
  application_status: ApplicationStatus | null;
  submitted_at: string | null;
  correction_deadline: string | null;
  review_comment: string | null;
  /** true si el estudiante puede escribir ahora mismo. */
  can_edit: boolean;
}

export interface MyApplicationDetail {
  form: MyApplicationFormSummary;
  application: Application | null;
  files: ApplicationFileMeta[];
  reviews: ApplicationReview[];
  prefill: ApplicationPrefill;
  /**
   * Campos editables ahora mismo. En DRAFT son todos menos el correo; en
   * CONDITIONED solo los que el admin desbloqueó.
   */
  editable_fields: ApplicationFieldKey[];
  positions: ApplicationPosition[];
  sedes: string[];
  careers: string[];
}

export interface AuditActor {
  id?: string;
  carnet?: string;
  ip?: string;
}
