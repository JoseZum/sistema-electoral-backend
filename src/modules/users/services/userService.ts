import readXlsxFile from 'read-excel-file/node';
import type { Sheet } from 'read-excel-file/node';
import * as studentRepo from '../repositories/studentRepository';
import * as adminRepo from '../repositories/adminRepository';
import { CreateStudentDto, UpdateStudentDto, StudentFiltersDto } from '../dtos/studentDtos';
import { CreateAdminDto, UpdateAdminDto } from '../dtos/adminDtos';
import {
  AuditActor,
  withAuditContext,
  withAuditContextDryRun,
} from '../../../config/audit-context';
import { badRequest, conflict, notFound, withMeta } from '../../../errors/httpErrors';
import {
  analyzeWorkbook,
  applyMapping,
  type AnalyzeResult,
  type ColumnMapping,
  type PadronField,
  type RowIssue,
} from './padronParser';

function normalizeCatalogEntry(value: string) {
  return value.trim();
}

async function validateStudentCatalogSelection(data: {
  sede?: string;
  career?: string;
}) {
  if (data.sede === undefined && data.career === undefined) {
    return;
  }

  const catalog = await studentRepo.findStudentCatalog();

  if (data.sede !== undefined) {
    const sede = normalizeCatalogEntry(data.sede);
    const validSedes = new Set(catalog.sedes.map(normalizeCatalogEntry));
    if (!validSedes.has(sede)) {
      throw badRequest('STUDENT_INVALID_SEDE', 'La sede seleccionada no existe en el padrón actual');
    }
  }

  if (data.career !== undefined) {
    const career = normalizeCatalogEntry(data.career);
    const validCareers = new Set(catalog.careers.map(normalizeCatalogEntry));
    if (!validCareers.has(career)) {
      throw badRequest('STUDENT_INVALID_CAREER', 'La carrera seleccionada no existe en el padrón actual');
    }
  }
}

// ── Estudiantes ──

export async function getAllStudents(filters: StudentFiltersDto) {
  return studentRepo.findAllStudents(filters);
}

export async function getStudentCatalog() {
  return studentRepo.findStudentCatalog();
}

export async function getStudentById(id: string) {
  const student = await studentRepo.findStudentById(id);
  if (!student) throw notFound('STUDENT_NOT_FOUND', 'Estudiante no encontrado');
  return student;
}

export async function createStudent(data: CreateStudentDto, actor?: AuditActor) {
  const existing = await studentRepo.findStudentByEmail(data.email);
  if (existing) throw conflict('STUDENT_EMAIL_ALREADY_EXISTS', 'Ya existe un estudiante con ese email');
  await validateStudentCatalogSelection({
    sede: data.sede,
    career: data.career,
  });
  return withAuditContext(
    { id: actor?.id, carnet: actor?.carnet, ip: actor?.ip },
    (client) => studentRepo.createStudent(data, client)
  );
}

export async function updateStudent(id: string, data: UpdateStudentDto, actor?: AuditActor) {
  await validateStudentCatalogSelection({
    sede: data.sede,
    career: data.career,
  });
  const student = await withAuditContext(
    { id: actor?.id, carnet: actor?.carnet, ip: actor?.ip },
    (client) => studentRepo.updateStudent(id, data, client)
  );
  if (!student) throw notFound('STUDENT_NOT_FOUND', 'Estudiante no encontrado');
  return student;
}

export async function deactivateStudent(id: string, actor?: AuditActor) {
  const student = await withAuditContext(
    { id: actor?.id, carnet: actor?.carnet, ip: actor?.ip },
    (client) => studentRepo.deactivateStudent(id, client)
  );
  if (!student) throw notFound('STUDENT_NOT_FOUND', 'Estudiante no encontrado');
  return student;
}

// ── Importación del padrón ──

/**
 * A partir de cuántas bajas se le exige al admin una confirmación explícita.
 *
 * El import reemplaza el padrón completo: todo estudiante que no venga en el
 * archivo queda inactivo. Un cierre de semestre da de baja a unos cientos de
 * egresados y pasa sin fricción; un archivo parcial daría de baja a casi todos
 * y ahí es donde hay que frenar y preguntar.
 *
 * La regla es proporcional, no absoluta: un tope fijo alto nunca se alcanzaría
 * en un padrón chico (una prueba con 45 estudiantes borraría 43 sin avisar) y
 * uno bajo pediría confirmación en cada importación de un padrón grande.
 * `DEACTIVATION_MIN_ABSOLUTE` solo evita el ruido de las bajas pequeñas.
 */
export const DEACTIVATION_MIN_ABSOLUTE = 10;
export const DEACTIVATION_RATIO = 0.05;

export function requiresDeactivationConfirmation(
  deactivated: number,
  activeStudents: number
): boolean {
  if (deactivated < DEACTIVATION_MIN_ABSOLUTE) return false;
  if (activeStudents <= 0) return false;
  return deactivated / activeStudents > DEACTIVATION_RATIO;
}

export interface PadronImportOptions {
  sheetIndex?: number;
  headerRowIndex?: number;
  mapping?: ColumnMapping;
  confirmDeactivation?: boolean;
}

export interface PadronImportSummary {
  total: number;
  new: number;
  updated: number;
  reactivated: number;
  deactivated: number;
  carnet_migrated?: number;
  email_swapped?: number;
}

export interface PadronAnalysis extends AnalyzeResult {
  /** Qué pasaría si se aplicara este mapeo. `null` si el mapeo aún no sirve. */
  diff: PadronImportSummary | null;
  requiresConfirmation: boolean;
  activeStudents: number;
}

async function readWorkbook(fileBuffer: Buffer): Promise<Sheet[]> {
  try {
    return await readXlsxFile(fileBuffer);
  } catch {
    throw badRequest(
      'PADRON_FILE_UNREADABLE',
      'No se pudo leer el archivo. Verifique que sea un Excel .xlsx válido y no esté protegido con contraseña.'
    );
  }
}

const FIELD_LABELS: Record<PadronField, string> = {
  carnet: 'el carnet',
  full_name: 'el nombre',
  email: 'el correo',
  sede: 'la sede',
  career: 'la carrera',
  degree_level: 'el grado',
};

/** Nombra solo los campos que faltan, no la lista completa de obligatorios. */
function describeFields(fields: PadronField[]): string {
  const labels = fields.map((field) => FIELD_LABELS[field]);
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} y ${labels[labels.length - 1]}`;
}

/** Convierte las filas descartadas en un mensaje corto para el admin. */
function summarizeIssues(issues: RowIssue[]): string {
  return issues
    .slice(0, 3)
    .map((issue) => `fila ${issue.row}: ${issue.reason}`)
    .join('; ');
}

/**
 * Analiza el archivo sin aplicar nada: detecta la estructura, propone el mapeo y
 * calcula el diff real corriendo la importación dentro de una transacción que se
 * revierte. Es lo que alimenta la pantalla de confirmación.
 */
export async function analyzePadron(
  fileBuffer: Buffer,
  options: PadronImportOptions = {},
  actor?: AuditActor
): Promise<PadronAnalysis> {
  const sheets = await readWorkbook(fileBuffer);
  const catalog = await studentRepo.findStudentCatalog();

  const analysis = analyzeWorkbook(sheets, {
    catalog,
    sheetIndex: options.sheetIndex,
    headerRowIndex: options.headerRowIndex,
    mapping: options.mapping,
  });

  // Sin los campos obligatorios o sin filas válidas no hay nada que simular:
  // la UI le pide al admin que complete el mapeo.
  if (analysis.missingRequired.length > 0 || analysis.validRows === 0) {
    return {
      ...analysis,
      diff: null,
      requiresConfirmation: false,
      activeStudents: await studentRepo.countActiveStudents(),
    };
  }

  const rows = applyMapping(
    sheets[analysis.sheetIndex]?.data ?? [],
    analysis.headerRowIndex,
    analysis.mapping
  ).rows;

  const { diff, activeStudents } = await withAuditContextDryRun(
    { id: actor?.id, carnet: actor?.carnet, ip: actor?.ip },
    async (client) => ({
      activeStudents: await studentRepo.countActiveStudents(client),
      diff: await studentRepo.importPadron(rows, client),
    })
  );

  return {
    ...analysis,
    diff,
    requiresConfirmation: requiresDeactivationConfirmation(diff.deactivated, activeStudents),
    activeStudents,
  };
}

/**
 * Aplica el padrón con el mapeo que el admin confirmó.
 *
 * El umbral de bajas se vuelve a validar acá, contra el diff real y dentro de la
 * transacción: si hace falta confirmación y no vino, se lanza un 409 y el
 * ROLLBACK deja la base como estaba. La UI no puede saltarse este control.
 */
export async function importPadron(
  fileBuffer: Buffer,
  options: PadronImportOptions = {},
  actor?: AuditActor
): Promise<PadronImportSummary> {
  const sheets = await readWorkbook(fileBuffer);
  const catalog = await studentRepo.findStudentCatalog();

  const analysis = analyzeWorkbook(sheets, {
    catalog,
    sheetIndex: options.sheetIndex,
    headerRowIndex: options.headerRowIndex,
    mapping: options.mapping,
  });

  if (analysis.missingRequired.length > 0) {
    throw withMeta(
      400,
      'PADRON_MAPPING_INCOMPLETE',
      `Falta indicar qué columna trae: ${describeFields(analysis.missingRequired)}.`,
      { missingRequired: analysis.missingRequired }
    );
  }

  const parsed = applyMapping(
    sheets[analysis.sheetIndex]?.data ?? [],
    analysis.headerRowIndex,
    analysis.mapping
  );

  if (parsed.rows.length === 0) {
    throw withMeta(
      400,
      'PADRON_FILE_NO_VALID_DATA',
      parsed.totalRows === 0
        ? 'La hoja seleccionada no tiene filas de datos debajo del encabezado.'
        : `Ninguna de las ${parsed.totalRows} filas es válida (${summarizeIssues(parsed.issues)}).`,
      { totalRows: parsed.totalRows, issues: parsed.issues.slice(0, 25) }
    );
  }

  return withAuditContext(
    { id: actor?.id, carnet: actor?.carnet, ip: actor?.ip },
    async (client) => {
      const activeStudents = await studentRepo.countActiveStudents(client);
      const summary = await studentRepo.importPadron(parsed.rows, client);

      if (
        !options.confirmDeactivation &&
        requiresDeactivationConfirmation(summary.deactivated, activeStudents)
      ) {
        // El throw revierte la transacción: no se aplica ni una fila.
        throw withMeta(
          409,
          'PADRON_IMPORT_NEEDS_CONFIRMATION',
          `Este archivo desactivaría a ${summary.deactivated} de ${activeStudents} estudiantes activos. Confirme para continuar.`,
          { ...summary, activeStudents }
        );
      }

      return summary;
    }
  );
}

// ── Admins ──

export async function getAllAdmins() {
  return adminRepo.findAllAdmins();
}

export async function getAdminById(id: string) {
  const admin = await adminRepo.findAdminById(id);
  if (!admin) throw notFound('ADMIN_NOT_FOUND', 'Admin no encontrado');
  return admin;
}

export async function createAdmin(data: CreateAdminDto, actor?: AuditActor) {
  const existing = await adminRepo.findAdminByStudentId(data.students_id);
  if (existing) throw conflict('ADMIN_STUDENT_ALREADY_ADMIN', 'Este estudiante ya es admin');
  return withAuditContext(
    { id: actor?.id, carnet: actor?.carnet, ip: actor?.ip },
    (client) => adminRepo.createAdmin(data, client)
  );
}

export async function updateAdmin(id: string, data: UpdateAdminDto, actor?: AuditActor) {
  const admin = await withAuditContext(
    { id: actor?.id, carnet: actor?.carnet, ip: actor?.ip },
    (client) => adminRepo.updateAdmin(id, data, client)
  );
  if (!admin) throw notFound('ADMIN_NOT_FOUND', 'Admin no encontrado');
  return admin;
}

export async function deleteAdmin(id: string, actor?: AuditActor) {
  return withAuditContext(
    { id: actor?.id, carnet: actor?.carnet, ip: actor?.ip },
    async (client) => {
      const totalAdmins = await adminRepo.countAdmins(client);
      if (totalAdmins <= 1) {
        throw conflict('ADMIN_MINIMUM_REQUIRED', 'Debe existir al menos un administrador');
      }

      const firstAdmin = await adminRepo.findFirstAdmin(client);
      if (firstAdmin?.id === id) {
        throw conflict('ADMIN_FIRST_ADMIN_PROTECTED', 'El primer administrador no se puede eliminar');
      }

      const admin = await adminRepo.deleteAdmin(id, client);
      if (!admin) throw notFound('ADMIN_NOT_FOUND', 'Admin no encontrado');
      return admin;
    }
  );
}
