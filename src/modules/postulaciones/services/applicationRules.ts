import { badRequest } from '../../../errors/httpErrors';
import {
  ALLOWED_MIME_TYPES,
  ApplicationFieldKey,
  FIELD_LABELS,
  FILE_FIELD_KEYS,
  REQUIRED_EMAIL_DOMAIN,
  REQUIRED_FILE_FIELD_KEYS,
  SELECT_FIELD_KEYS,
  TEXT_FIELD_KEYS,
  isUnlockableFieldKey,
} from '../constants/applicationFields';
import {
  Application,
  ApplicationFileMeta,
  ApplicationForm,
  ApplicationStatus,
} from '../models/postulacionModel';

/**
 * Reglas puras del dominio de postulaciones.
 *
 * Todo lo que hay aqui es determinista y sin acceso a base de datos, para
 * poder testearlo directo sin levantar la app.
 */

// ============================================
// PRELLENADO DESDE EL PADRON
// ============================================

/**
 * Parte el `full_name` del padron en apellidos y nombre.
 *
 * El padron institucional viene como "APELLIDO1 APELLIDO2 NOMBRE(S)".
 * Es una heuristica: los apellidos compuestos ("De la Cruz") no se parten
 * bien, pero los tres campos quedan editables para que el estudiante lo
 * corrija.
 */
export function splitFullName(fullName?: string | null): {
  last_name_1: string;
  last_name_2: string;
  first_name: string;
} {
  const tokens = (fullName || '').trim().split(/\s+/).filter(Boolean);

  if (tokens.length === 0) {
    return { last_name_1: '', last_name_2: '', first_name: '' };
  }
  if (tokens.length === 1) {
    return { last_name_1: '', last_name_2: '', first_name: tokens[0] };
  }
  if (tokens.length === 2) {
    return { last_name_1: tokens[0], last_name_2: '', first_name: tokens[1] };
  }

  return {
    last_name_1: tokens[0],
    last_name_2: tokens[1],
    first_name: tokens.slice(2).join(' '),
  };
}

/**
 * Intenta recuperar la cedula desde la columna `degree_level` del padron.
 *
 * En el padron actual esa columna dejo de traer el grado academico
 * ("Bachillerato") y trae el numero de identificacion. Como no es fiable,
 * solo se prellena cuando el valor es claramente un numero de cedula; en
 * cualquier otro caso se devuelve vacio y el estudiante lo escribe a mano.
 * El campo nunca se bloquea.
 */
export function guessNationalIdFromDegreeLevel(degreeLevel?: string | null): string {
  const normalized = (degreeLevel || '').replace(/[\s-]/g, '');
  return /^\d{8,12}$/.test(normalized) ? normalized : '';
}

// ============================================
// NORMALIZACION DE CAMPOS
// ============================================

export function normalizeText(value?: string | null): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed === '' ? null : trimmed;
}

/**
 * El cliente pidio explicitamente cedula, carne y telefono "sin guiones ni
 * espacios". Se aceptan al escribir y se limpian, pero cualquier otro
 * caracter es un error.
 */
export function normalizeDigits(
  value: string | null | undefined,
  field: ApplicationFieldKey
): string | null {
  if (value === null || value === undefined) return null;

  const trimmed = value.trim();
  if (trimmed === '') return null;

  const stripped = trimmed.replace(/[\s-]/g, '');
  if (!/^\d+$/.test(stripped)) {
    throw badRequest(
      'APPLICATION_FIELD_NOT_NUMERIC',
      `${FIELD_LABELS[field]} solo puede contener números, sin guiones ni espacios`
    );
  }
  return stripped;
}

export function assertInstitutionalEmail(email?: string | null): string {
  const normalized = (email || '').trim().toLowerCase();

  if (!normalized.endsWith(REQUIRED_EMAIL_DOMAIN)) {
    throw badRequest(
      'APPLICATION_EMAIL_DOMAIN',
      `El correo debe ser institucional (${REQUIRED_EMAIL_DOMAIN})`
    );
  }
  return normalized;
}

// ============================================
// PERMISOS DE EDICION
// ============================================

/**
 * Campos que el estudiante puede escribir AHORA MISMO.
 *
 * - DRAFT: todo menos el correo (que sale de la sesion de Microsoft).
 * - CONDITIONED: unicamente los campos que el admin desbloqueo.
 * - Cualquier otro estado: nada.
 *
 * El backend siempre recorta contra esta lista; que el frontend deshabilite
 * el input es solo una cortesia visual.
 */
export function resolveEditableFields(
  application: Application | null,
  form: Pick<ApplicationForm, 'allow_other_documents'>,
  hasPositions = false
): ApplicationFieldKey[] {
  const everything: ApplicationFieldKey[] = [
    ...TEXT_FIELD_KEYS.filter((key) => key !== 'email'),
    // El puesto solo existe como campo si el formulario define alguno.
    ...SELECT_FIELD_KEYS.filter((key) => key !== 'position_id' || hasPositions),
    ...FILE_FIELD_KEYS.filter((key) => key !== 'other' || form.allow_other_documents),
  ];

  if (!application || application.status === 'DRAFT') {
    return everything;
  }

  if (application.status === 'CONDITIONED') {
    const unlocked = new Set(application.unlocked_fields ?? []);
    return everything.filter((key) => unlocked.has(key));
  }

  return [];
}

/** true si el formulario acepta escrituras del estudiante en este momento. */
export function canStudentWrite(
  application: Application | null,
  form: Pick<ApplicationForm, 'status' | 'allow_other_documents'>,
  now: Date = new Date()
): { allowed: boolean; reason?: { code: string; message: string } } {
  const status: ApplicationStatus | null = application?.status ?? null;

  if (status === 'APPROVED' || status === 'REJECTED') {
    return {
      allowed: false,
      reason: {
        code: 'APPLICATION_ALREADY_RESOLVED',
        message: 'Esta postulación ya fue resuelta y no admite cambios',
      },
    };
  }

  // Ya enviada y a la espera de revisión: se congela hasta que el admin la
  // resuelva. Solo un CONDITIONED la vuelve a abrir, y solo en parte.
  if (status === 'SUBMITTED') {
    return {
      allowed: false,
      reason: {
        code: 'APPLICATION_ALREADY_SUBMITTED',
        message: 'Tu postulación ya fue enviada y está en revisión',
      },
    };
  }

  // Una postulación condicionada se puede corregir aunque el formulario ya
  // haya cerrado: el admin normalmente revisa cuando el plazo general venció.
  // Lo que manda entonces es el plazo propio de corrección.
  if (status === 'CONDITIONED') {
    const deadline = application?.correction_deadline
      ? new Date(application.correction_deadline)
      : null;

    if (deadline && deadline.getTime() <= now.getTime()) {
      return {
        allowed: false,
        reason: {
          code: 'APPLICATION_CORRECTION_EXPIRED',
          message: 'El plazo para corregir esta postulación ya venció',
        },
      };
    }
    return { allowed: true };
  }

  if (form.status !== 'OPEN') {
    return {
      allowed: false,
      reason: {
        code: 'APPLICATION_FORM_NOT_OPEN',
        message: 'Este formulario no está abierto en este momento',
      },
    };
  }

  return { allowed: true };
}

/**
 * Recorta un objeto de datos a los campos que el estudiante puede escribir.
 * Los campos no permitidos se descartan en silencio en vez de reventar,
 * para que un formulario condicionado pueda reenviar su estado completo.
 */
export function pickEditableData<T extends Record<string, unknown>>(
  data: T,
  editableFields: ApplicationFieldKey[]
): Partial<T> {
  const allowed = new Set<string>(editableFields);
  const result: Partial<T> = {};

  for (const [key, value] of Object.entries(data)) {
    if (allowed.has(key)) {
      result[key as keyof T] = value as T[keyof T];
    }
  }
  return result;
}

// ============================================
// COMPLETITUD PARA ENVIAR
// ============================================

/**
 * "Impedir que el usuario envíe el formulario si no ha llenado todas las
 * opciones." Devuelve las etiquetas de lo que falta.
 */
export function findMissingFields(
  application: Application,
  files: ApplicationFileMeta[],
  hasPositions = false
): string[] {
  const missing: string[] = [];

  const requiredData: ApplicationFieldKey[] = [
    'last_name_1',
    'last_name_2',
    'first_name',
    'email',
    'national_id',
    'carnet',
    'phone',
    'sede',
    'career',
    // Si el formulario define puestos, elegir uno es obligatorio.
    ...(hasPositions ? (['position_id'] as ApplicationFieldKey[]) : []),
  ];

  for (const field of requiredData) {
    const value = application[field as keyof Application];
    if (typeof value !== 'string' || value.trim() === '') {
      missing.push(FIELD_LABELS[field]);
    }
  }

  const uploaded = new Set(files.map((file) => file.field_key));
  for (const field of REQUIRED_FILE_FIELD_KEYS) {
    if (!uploaded.has(field)) {
      missing.push(FIELD_LABELS[field]);
    }
  }

  return missing;
}

// ============================================
// VALIDACION DE ARCHIVOS
// ============================================

const MAGIC_BYTES: Array<{ mime: string; matches: (buffer: Buffer) => boolean }> = [
  { mime: 'application/pdf', matches: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { mime: 'image/jpeg', matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'image/png',
    matches: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mime: 'image/webp',
    matches: (b) =>
      b.subarray(0, 4).toString('latin1') === 'RIFF' &&
      b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
];

/**
 * Deduce el tipo real del archivo a partir de su contenido.
 *
 * El `mimetype` que manda el navegador lo controla el cliente, asi que un
 * ejecutable renombrado a .pdf llegaria como "application/pdf". Se valida
 * contra los magic bytes y se guarda el tipo detectado, no el declarado.
 */
export function detectMimeType(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  return MAGIC_BYTES.find((entry) => entry.matches(buffer))?.mime ?? null;
}

export function assertAllowedFile(buffer: Buffer, originalName: string): string {
  const detected = detectMimeType(buffer);

  if (!detected || !(ALLOWED_MIME_TYPES as readonly string[]).includes(detected)) {
    throw badRequest(
      'APPLICATION_FILE_TYPE_NOT_ALLOWED',
      `El archivo "${originalName}" no es un PDF ni una imagen válida`
    );
  }
  return detected;
}

/**
 * Recupera el nombre original de un adjunto subido por multipart.
 *
 * busboy (y por tanto multer) decodifica el nombre del archivo como latin1,
 * asi que "identificación.pdf" llega como "identificaciÃ³n.pdf". Se
 * reinterpretan esos bytes como UTF-8 para no guardar el nombre corrompido.
 * Si el resultado no es UTF-8 valido se devuelve el original tal cual.
 */
export function decodeMultipartFileName(originalName: string): string {
  if (!originalName) return originalName;

  // Un nombre ya correcto en ASCII no necesita conversion.
  if (!/[\u0080-\u00ff]/.test(originalName)) return originalName;

  const decoded = Buffer.from(originalName, 'latin1').toString('utf8');
  return decoded.includes('\ufffd') ? originalName : decoded;
}

/**
 * Evita path traversal y nombres absurdos al guardar/servir el adjunto.
 *
 * El nombre acaba dentro de una cabecera `Content-Disposition`, asi que
 * tambien hay que reducirlo a caracteres seguros para que nadie pueda
 * inyectar parametros extra en la respuesta.
 */
export function sanitizeFileName(originalName: string): string {
  const base = (originalName || 'archivo')
    .replace(/[\\/]/g, '_')
    .replace(/[^A-Za-z0-9._ ()\u00C0-\u024F-]/g, '_')
    .trim();

  const safe = base === '' ? 'archivo' : base;
  return safe.length > 120 ? safe.slice(safe.length - 120) : safe;
}

// ============================================
// PUESTOS
// ============================================

/**
 * Normaliza y valida el nombre de un puesto. Solo tiene nombre, asi que es
 * lo unico que hay que cuidar.
 */
export function normalizePositionName(name?: string | null): string {
  const normalized = normalizeText(name);

  if (!normalized) {
    throw badRequest('APPLICATION_POSITION_NAME_REQUIRED', 'El puesto necesita un nombre');
  }
  if (normalized.length > 120) {
    throw badRequest(
      'APPLICATION_POSITION_NAME_TOO_LONG',
      'El nombre del puesto no puede pasar de 120 caracteres'
    );
  }
  return normalized;
}

// ============================================
// REVISION
// ============================================

/** Filtra la lista de campos a desbloquear, descartando claves inventadas. */
export function normalizeUnlockedFields(fields?: string[] | null): ApplicationFieldKey[] {
  if (!Array.isArray(fields)) return [];

  const unique = new Set<ApplicationFieldKey>();
  for (const field of fields) {
    if (typeof field === 'string' && isUnlockableFieldKey(field)) {
      unique.add(field);
    }
  }
  return Array.from(unique);
}
