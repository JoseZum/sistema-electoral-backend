/**
 * Definicion de los campos fijos del formulario de postulacion.
 *
 * El cliente especifico que el formulario tiene una parte VARIABLE que el
 * admin configura (titulo, descripcion, ventana de tiempo) y una parte FIJA
 * que no cambia: estos campos. La unica excepcion configurable es
 * `other` ("Otros PDF"), que el admin decide si habilita o no.
 */

/** Campos de texto libre que escribe el postulante. */
export const TEXT_FIELD_KEYS = [
  'last_name_1',
  'last_name_2',
  'first_name',
  'email',
  'national_id',
  'carnet',
  'phone',
] as const;

/**
 * Campos de lista desplegable.
 *
 * `position_id` solo se muestra si el formulario define puestos; en ese caso
 * es obligatorio para poder enviar.
 */
export const SELECT_FIELD_KEYS = ['sede', 'career', 'position_id'] as const;

/** Campos de archivo. `other` solo existe si el admin lo habilito. */
export const FILE_FIELD_KEYS = [
  'enrollment_report',
  'id_copy',
  'carnet_copy',
  'tdf_letter',
  'th_letter',
  'other',
] as const;

/** Campos de archivo obligatorios para poder enviar la postulacion. */
export const REQUIRED_FILE_FIELD_KEYS = [
  'enrollment_report',
  'id_copy',
  'carnet_copy',
  'tdf_letter',
  'th_letter',
] as const;

export type TextFieldKey = (typeof TEXT_FIELD_KEYS)[number];
export type SelectFieldKey = (typeof SELECT_FIELD_KEYS)[number];
export type FileFieldKey = (typeof FILE_FIELD_KEYS)[number];
export type ApplicationFieldKey = TextFieldKey | SelectFieldKey | FileFieldKey;

/** Campos de datos (texto + select) que se persisten como columnas. */
export const DATA_FIELD_KEYS = [...TEXT_FIELD_KEYS, ...SELECT_FIELD_KEYS] as const;

/**
 * Campos que el admin puede reabrir al marcar una postulacion como
 * CONDICIONADA. El correo queda fuera a proposito: siempre se toma de la
 * sesion de Microsoft, asi que permitir editarlo abriria la puerta a que
 * alguien se postule con la identidad de otra persona.
 */
export const UNLOCKABLE_FIELD_KEYS: readonly ApplicationFieldKey[] = [
  ...TEXT_FIELD_KEYS.filter((key) => key !== 'email'),
  ...SELECT_FIELD_KEYS,
  ...FILE_FIELD_KEYS,
] as ApplicationFieldKey[];

/** Etiquetas en espanol para mensajes de error del backend. */
export const FIELD_LABELS: Record<ApplicationFieldKey, string> = {
  last_name_1: 'Apellido 1',
  last_name_2: 'Apellido 2',
  first_name: 'Nombre',
  email: 'Correo estudiantil',
  national_id: 'Número de identificación',
  carnet: 'Número de carné',
  phone: 'Número de teléfono',
  sede: 'Sede',
  career: 'Carrera',
  position_id: 'Puesto al que se postula',
  enrollment_report: 'Informe de matrícula',
  id_copy: 'Copia de la identificación',
  carnet_copy: 'Copia del carné',
  tdf_letter: 'Carta de sanciones del TDF',
  th_letter: 'Carta de sanciones del TH',
  other: 'Otros documentos',
};

/** Dominio institucional exigido por el cliente. */
export const REQUIRED_EMAIL_DOMAIN = '@estudiantec.cr';

/** Tipos MIME aceptados: "solo imágenes o PDF". */
export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

/**
 * 4 MB. Vercel limita el cuerpo de una funcion serverless a 4.5 MB, asi que
 * cada archivo se sube en su propia peticion y por debajo de ese techo.
 */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;

export function isFileFieldKey(value: string): value is FileFieldKey {
  return (FILE_FIELD_KEYS as readonly string[]).includes(value);
}

export function isUnlockableFieldKey(value: string): value is ApplicationFieldKey {
  return (UNLOCKABLE_FIELD_KEYS as readonly string[]).includes(value);
}
