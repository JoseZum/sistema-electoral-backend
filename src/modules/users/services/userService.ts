import XLSX from 'xlsx';
import * as studentRepo from '../repositories/studentRepository';
import * as adminRepo from '../repositories/adminRepository';
import { CreateStudentDto, UpdateStudentDto, StudentFiltersDto } from '../dtos/studentDtos';
import { CreateAdminDto, UpdateAdminDto } from '../dtos/adminDtos';

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
export async function importPadron(fileBuffer: Buffer) {
  const workbook = XLSX.read(fileBuffer, { type: 'buffer' });

  const data: Record<string, unknown>[] = [];
  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      workbook.Sheets[sheetName],
      { defval: null }
    );
    data.push(...rows);
  }

  if (data.length === 0) throw new Error('El archivo no contiene datos');

  await studentRepo.importPadron(data);

  return { total: data.length };
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
