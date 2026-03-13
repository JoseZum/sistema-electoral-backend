import XLSX from 'xlsx';
import * as studentRepo from '../repositories/studentRepository';
import * as adminRepo from '../repositories/adminRepository';
import { CreateStudentDto, UpdateStudentDto, StudentFiltersDto } from '../dtos/studentDtos';
import { CreateAdminDto, UpdateAdminDto } from '../dtos/adminDtos';
import { withAuditContext } from '../../../config/audit-context';

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

// ── Estudiantes ──

export async function getAllStudents(filters: StudentFiltersDto) {
  return studentRepo.findAllStudents(filters);
}

export async function getStudentById(id: string) {
  const student = await studentRepo.findStudentById(id);
  if (!student) throw new Error('Estudiante no encontrado');
  return student;
}

export async function createStudent(data: CreateStudentDto) {
  const existing = await studentRepo.findStudentByEmail(data.email);
  if (existing) throw new Error('Ya existe un estudiante con ese email');
  return studentRepo.createStudent(data);
}

export async function updateStudent(id: string, data: UpdateStudentDto) {
  const student = await studentRepo.updateStudent(id, data);
  if (!student) throw new Error('Estudiante no encontrado');
  return student;
}

export async function deactivateStudent(id: string) {
  const student = await studentRepo.deactivateStudent(id);
  if (!student) throw new Error('Estudiante no encontrado');
  return student;
}

// Importar padrón desde archivo XLSX
export async function importPadron(
  fileBuffer: Buffer,
  actor?: { carnet?: string; ip?: string }
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
    { carnet: actor?.carnet, ip: actor?.ip },
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

export async function createAdmin(data: CreateAdminDto) {
  const existing = await adminRepo.findAdminByStudentId(data.students_id);
  if (existing) throw new Error('Este estudiante ya es admin');
  return adminRepo.createAdmin(data);
}

export async function updateAdmin(id: string, data: UpdateAdminDto) {
  const admin = await adminRepo.updateAdmin(id, data);
  if (!admin) throw new Error('Admin no encontrado');
  return admin;
}

export async function deactivateAdmin(id: string) {
  const admin = await adminRepo.deactivateAdmin(id);
  if (!admin) throw new Error('Admin no encontrado');
  return admin;
}
