import XLSX from 'xlsx';
import * as studentRepo from '../repositories/studentRepository';
import * as adminRepo from '../repositories/adminRepository';
import { CreateStudentDto, UpdateStudentDto, StudentFiltersDto } from '../dtos/studentDtos';
import { CreateAdminDto, UpdateAdminDto } from '../dtos/adminDtos';
import { AuditActor, withAuditContext } from '../../../config/audit-context';

function normalizeKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita tildes
    .trim()
    .toLowerCase();
}

function getValueFromRow(row: Record<string, unknown>, possibleKeys: string[]) {
  const normalizedRow: Record<string, unknown> = {};

  for (const key of Object.keys(row)) {
    normalizedRow[normalizeKey(key)] = row[key];
  }

  for (const key of possibleKeys) {
    const value = normalizedRow[normalizeKey(key)];
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }

  return null;
}

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
      throw new Error('La sede seleccionada no existe en el padrón actual');
    }
  }

  if (data.career !== undefined) {
    const career = normalizeCatalogEntry(data.career);
    const validCareers = new Set(catalog.careers.map(normalizeCatalogEntry));
    if (!validCareers.has(career)) {
      throw new Error('La carrera seleccionada no existe en el padrón actual');
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
  if (!student) throw new Error('Estudiante no encontrado');
  return student;
}

export async function createStudent(data: CreateStudentDto, actor?: AuditActor) {
  const existing = await studentRepo.findStudentByEmail(data.email);
  if (existing) throw new Error('Ya existe un estudiante con ese email');
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
  if (!student) throw new Error('Estudiante no encontrado');
  return student;
}

export async function deactivateStudent(id: string, actor?: AuditActor) {
  const student = await withAuditContext(
    { id: actor?.id, carnet: actor?.carnet, ip: actor?.ip },
    (client) => studentRepo.deactivateStudent(id, client)
  );
  if (!student) throw new Error('Estudiante no encontrado');
  return student;
}

// Importar padrón desde archivo XLSX
export async function importPadron(
  fileBuffer: Buffer,
  actor?: AuditActor
) {
  const workbook = XLSX.read(fileBuffer, { type: 'buffer' });

  const data: Record<string, unknown>[] = [];
  for (const sheetName of workbook.SheetNames) {
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      workbook.Sheets[sheetName],
      {
        defval: null,
        range: 3 // asume que la cabecera real está en la fila 4 debido a títulos previos
      }
    );

    const normalizedRows = rawRows.map(row => ({
      Carnet: String(getValueFromRow(row, ['carné', 'carnet', 'carne']) || '').trim(),
      Nombre: getValueFromRow(row, ['nombre completo', 'nombre', 'full name']),
      Correo: getValueFromRow(row, ['correo', 'email', 'correo electronico']),
      Sede: getValueFromRow(row, ['sede', 'campus']),
      Carrera: getValueFromRow(row, ['carrera', 'career', 'programa']),
      Grado: getValueFromRow(row, ['grado', 'nivel', 'degree']) ?? 'NO_ESPECIFICADO'
    }));

    data.push(...normalizedRows.filter(r => r.Carnet && r.Nombre && r.Correo));
  }

  if (data.length === 0) throw new Error('El archivo no contiene datos válidos');

  // Run inside audit context so triggers capture WHO did this
  const summary = await withAuditContext(
    { id: actor?.id, carnet: actor?.carnet, ip: actor?.ip },
    (client) => studentRepo.importPadron(data, client)
  );

  return summary;
}

// ── Admins ──

export async function getAllAdmins() {
  return adminRepo.findAllAdmins();
}

export async function getAdminById(id: string) {
  const admin = await adminRepo.findAdminById(id);
  if (!admin) throw new Error('Admin no encontrado');
  return admin;
}

export async function createAdmin(data: CreateAdminDto, actor?: AuditActor) {
  const existing = await adminRepo.findAdminByStudentId(data.students_id);
  if (existing) throw new Error('Este estudiante ya es admin');
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
  if (!admin) throw new Error('Admin no encontrado');
  return admin;
}

export async function deleteAdmin(id: string, actor?: AuditActor) {
  return withAuditContext(
    { id: actor?.id, carnet: actor?.carnet, ip: actor?.ip },
    async (client) => {
      const totalAdmins = await adminRepo.countAdmins(client);
      if (totalAdmins <= 1) {
        throw new Error('Debe existir al menos un administrador');
      }

      const firstAdmin = await adminRepo.findFirstAdmin(client);
      if (firstAdmin?.id === id) {
        throw new Error('El primer administrador no se puede eliminar');
      }

      const admin = await adminRepo.deleteAdmin(id, client);
      if (!admin) throw new Error('Admin no encontrado');
      return admin;
    }
  );
}
