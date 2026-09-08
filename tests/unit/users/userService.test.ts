import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/modules/users/repositories/studentRepository');
vi.mock('../../../src/modules/users/repositories/adminRepository');
vi.mock('../../../src/config/database', () => ({
  pool: { connect: vi.fn() },
}));
vi.mock('../../../src/config/audit-context', () => ({
  withAuditContext: vi.fn(),
  withAuditContextDryRun: vi.fn(),
}));
vi.mock('read-excel-file/node', () => ({
  default: vi.fn(),
}));

import * as studentRepo from '../../../src/modules/users/repositories/studentRepository';
import * as adminRepo from '../../../src/modules/users/repositories/adminRepository';
import { withAuditContext, withAuditContextDryRun } from '../../../src/config/audit-context';
import { pool } from '../../../src/config/database';
import readXlsxFile from 'read-excel-file/node';
import {
  getAllStudents,
  getStudentCatalog,
  getStudentById,
  createStudent,
  updateStudent,
  deactivateStudent,
  importPadron,
  analyzePadron,
  requiresDeactivationConfirmation,
  getAllAdmins,
  getAdminById,
  createAdmin,
  updateAdmin,
  deleteAdmin,
} from '../../../src/modules/users/services/userService';
import { Student, Admin } from '../../../src/modules/users/models/userModel';

const mockStudent: Student = {
  id: 'student-uuid-1',
  carnet: '2021001234',
  full_name: 'Ana García',
  email: 'ana.garcia@estudiantec.cr',
  sede: 'Central',
  career: 'Ingeniería en Computación',
  degree_level: 'Bachillerato',
  is_active: true,
  created_at: new Date('2024-01-01'),
  updated_at: new Date('2024-01-02'),
};

const mockAdmin: Admin = {
  id: 'admin-uuid-1',
  students_id: 'student-uuid-1',
  position_title: 'Coordinador',
  role: 'admin',
  permissions: { canEdit: true },
  created_at: new Date('2024-01-01'),
  updated_at: new Date('2024-01-02'),
};

const actor = { id: 'admin-uuid-1', carnet: '2021000000', ip: '127.0.0.1' };

describe('userService', () => {
  let mockClient: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    };
    vi.mocked(withAuditContext).mockImplementation(async (_actor, fn) => fn(mockClient as any));
    vi.mocked(withAuditContextDryRun).mockImplementation(async (_actor, fn) => fn(mockClient as any));
    vi.mocked(pool.connect).mockResolvedValue(mockClient as any);
  });

  // ── getAllStudents ──────────────────────────────────────────────────────────

  describe('getAllStudents', () => {
    it('returns students from repository with filters', async () => {
      vi.mocked(studentRepo.findAllStudents).mockResolvedValue({ students: [mockStudent], total: 1 });
      const result = await getAllStudents({ sede: 'Central' });
      expect(result).toEqual({ students: [mockStudent], total: 1 });
      expect(studentRepo.findAllStudents).toHaveBeenCalledWith({ sede: 'Central' });
    });

    it('returns empty result when no students match', async () => {
      vi.mocked(studentRepo.findAllStudents).mockResolvedValue({ students: [], total: 0 });
      const result = await getAllStudents({});
      expect(result).toEqual({ students: [], total: 0 });
    });
  });

  // ── getStudentCatalog ──────────────────────────────────────────────────────

  describe('getStudentCatalog', () => {
    it('returns catalog from repository', async () => {
      const catalog = { sedes: ['Central'], careers: ['Computación'] };
      vi.mocked(studentRepo.findStudentCatalog).mockResolvedValue(catalog);
      const result = await getStudentCatalog();
      expect(result).toEqual(catalog);
    });
  });

  // ── getStudentById ─────────────────────────────────────────────────────────

  describe('getStudentById', () => {
    it('returns student when found', async () => {
      vi.mocked(studentRepo.findStudentById).mockResolvedValue(mockStudent);
      const result = await getStudentById('student-uuid-1');
      expect(result).toEqual(mockStudent);
    });

    it('throws when student not found', async () => {
      vi.mocked(studentRepo.findStudentById).mockResolvedValue(null);
      await expect(getStudentById('nonexistent')).rejects.toThrow('Estudiante no encontrado');
    });
  });

  // ── createStudent ──────────────────────────────────────────────────────────

  describe('createStudent', () => {
    const newStudentData = {
      carnet: '2021001234',
      full_name: 'Ana García',
      email: 'ana.garcia@estudiantec.cr',
      sede: 'Central',
      career: 'Ingeniería en Computación',
      degree_level: 'Bachillerato',
    };

    beforeEach(() => {
      vi.mocked(studentRepo.findStudentByEmail).mockResolvedValue(null);
      vi.mocked(studentRepo.findStudentCatalog).mockResolvedValue({
        sedes: ['Central'],
        careers: ['Ingeniería en Computación'],
      });
      vi.mocked(studentRepo.createStudent).mockResolvedValue(mockStudent);
    });

    it('creates student and returns record', async () => {
      const result = await createStudent(newStudentData, actor);
      expect(result).toEqual(mockStudent);
      expect(studentRepo.createStudent).toHaveBeenCalledWith(newStudentData, mockClient);
    });

    it('throws when email already in use', async () => {
      vi.mocked(studentRepo.findStudentByEmail).mockResolvedValue(mockStudent);
      await expect(createStudent(newStudentData, actor)).rejects.toThrow(
        'Ya existe un estudiante con ese email'
      );
    });

    it('throws when sede is not in catalog', async () => {
      vi.mocked(studentRepo.findStudentCatalog).mockResolvedValue({
        sedes: ['Alajuela'],
        careers: ['Ingeniería en Computación'],
      });
      await expect(createStudent({ ...newStudentData, sede: 'Inexistente' }, actor)).rejects.toThrow(
        'La sede seleccionada no existe en el padrón actual'
      );
    });

    it('throws when career is not in catalog', async () => {
      vi.mocked(studentRepo.findStudentCatalog).mockResolvedValue({
        sedes: ['Central'],
        careers: ['Administración'],
      });
      await expect(createStudent({ ...newStudentData, career: 'Inexistente' }, actor)).rejects.toThrow(
        'La carrera seleccionada no existe en el padrón actual'
      );
    });

    it('calls withAuditContext with actor data', async () => {
      await createStudent(newStudentData, actor);
      expect(withAuditContext).toHaveBeenCalledWith(
        { id: actor.id, carnet: actor.carnet, ip: actor.ip },
        expect.any(Function)
      );
    });
  });

  // ── updateStudent ──────────────────────────────────────────────────────────

  describe('updateStudent', () => {
    beforeEach(() => {
      vi.mocked(studentRepo.findStudentCatalog).mockResolvedValue({
        sedes: ['Central', 'Alajuela'],
        careers: ['Ingeniería en Computación'],
      });
      vi.mocked(studentRepo.updateStudent).mockResolvedValue(mockStudent);
    });

    it('updates student and returns updated record', async () => {
      const result = await updateStudent('student-uuid-1', { sede: 'Alajuela' }, actor);
      expect(result).toEqual(mockStudent);
      expect(studentRepo.updateStudent).toHaveBeenCalledWith(
        'student-uuid-1',
        { sede: 'Alajuela' },
        mockClient
      );
    });

    it('throws when student not found after update', async () => {
      vi.mocked(studentRepo.updateStudent).mockResolvedValue(null);
      await expect(updateStudent('nonexistent', { sede: 'Central' }, actor)).rejects.toThrow(
        'Estudiante no encontrado'
      );
    });

    it('throws when sede is not in catalog', async () => {
      await expect(
        updateStudent('student-uuid-1', { sede: 'Inexistente' }, actor)
      ).rejects.toThrow('La sede seleccionada no existe en el padrón actual');
    });

    it('throws when career is not in catalog', async () => {
      await expect(
        updateStudent('student-uuid-1', { career: 'Inexistente' }, actor)
      ).rejects.toThrow('La carrera seleccionada no existe en el padrón actual');
    });

    it('skips catalog validation when neither sede nor career is provided', async () => {
      await updateStudent('student-uuid-1', { full_name: 'Nuevo Nombre' }, actor);
      expect(studentRepo.findStudentCatalog).not.toHaveBeenCalled();
    });
  });

  // ── deactivateStudent ──────────────────────────────────────────────────────

  describe('deactivateStudent', () => {
    it('deactivates student and returns updated record', async () => {
      vi.mocked(studentRepo.deactivateStudent).mockResolvedValue({ ...mockStudent, is_active: false });
      const result = await deactivateStudent('student-uuid-1', actor);
      expect(result.is_active).toBe(false);
      expect(studentRepo.deactivateStudent).toHaveBeenCalledWith('student-uuid-1', mockClient);
    });

    it('throws when student not found', async () => {
      vi.mocked(studentRepo.deactivateStudent).mockResolvedValue(null);
      await expect(deactivateStudent('nonexistent', actor)).rejects.toThrow('Estudiante no encontrado');
    });
  });

  // ── importPadron ───────────────────────────────────────────────────────────

  describe('importPadron', () => {
    const summary = { total: 5, new: 3, updated: 1, reactivated: 1, deactivated: 0 };

    beforeEach(() => {
      vi.mocked(readXlsxFile).mockResolvedValue([
        {
          sheet: 'Hoja1',
          data: [
            [],
            [],
            [],
            ['carnet', 'nombre completo', 'correo', 'sede', 'carrera', 'grado'],
            ['2021001234', 'Ana García', 'ana@tec.cr', 'Central', 'Computación', 'Bachillerato'],
          ],
        },
      ] as any);
      vi.mocked(studentRepo.importPadron).mockResolvedValue(summary);
      vi.mocked(studentRepo.countActiveStudents).mockResolvedValue(10_000);
      vi.mocked(studentRepo.findStudentCatalog).mockResolvedValue({ sedes: [], careers: [] });
    });

    it('returns import summary on success', async () => {
      const result = await importPadron(Buffer.from(''), {}, actor);
      expect(result).toEqual(summary);
      expect(studentRepo.importPadron).toHaveBeenCalledWith(expect.any(Array), mockClient);
    });

    it('passes normalized rows to studentRepo.importPadron', async () => {
      await importPadron(Buffer.from(''), {}, actor);
      const rows = vi.mocked(studentRepo.importPadron).mock.calls[0][0] as any[];
      expect(rows[0]).toMatchObject({
        Carnet: '2021001234',
        Nombre: 'Ana García',
        Correo: 'ana@tec.cr',
      });
    });

    it('throws when required columns cannot be mapped', async () => {
      vi.mocked(readXlsxFile).mockResolvedValue([
        { sheet: 'Hoja1', data: [[], [], [], ['grado'], ['Bachillerato']] },
      ] as any);
      await expect(importPadron(Buffer.from(''), {}, actor)).rejects.toThrow(
        'Faltan columnas obligatorias'
      );
    });

    it('throws when the sheet has no data rows under the header', async () => {
      vi.mocked(readXlsxFile).mockResolvedValue([
        { sheet: 'Hoja1', data: [[], [], [], ['carnet', 'nombre', 'correo']] },
      ] as any);
      await expect(importPadron(Buffer.from(''), {}, actor)).rejects.toThrow(
        'no tiene filas de datos'
      );
    });

    // El mensaje ahora dice cuántas filas se descartaron y por qué, en vez del
    // «no contiene datos válidos» que no le decía nada al admin.
    it('explains why every row was discarded', async () => {
      vi.mocked(readXlsxFile).mockResolvedValue([
        {
          sheet: 'Hoja1',
          data: [
            [],
            [],
            [],
            ['carnet', 'nombre completo', 'correo'],
            ['', 'Ana García', 'ana@tec.cr'],
          ],
        },
      ] as any);
      await expect(importPadron(Buffer.from(''), {}, actor)).rejects.toThrow(
        /Ninguna de las 1 filas es válida.*sin carnet/
      );
    });

    it('calls withAuditContext with actor data', async () => {
      await importPadron(Buffer.from(''), {}, actor);
      expect(withAuditContext).toHaveBeenCalledWith(
        { id: actor.id, carnet: actor.carnet, ip: actor.ip },
        expect.any(Function)
      );
    });

    // Guardia contra el archivo parcial que desactiva el padrón entero.
    it('rejects with 409 when the import would deactivate too many students', async () => {
      vi.mocked(studentRepo.importPadron).mockResolvedValue({
        ...summary,
        deactivated: 9_999,
      });

      await expect(importPadron(Buffer.from(''), {}, actor)).rejects.toMatchObject({
        status: 409,
        code: 'PADRON_IMPORT_NEEDS_CONFIRMATION',
        meta: expect.objectContaining({ deactivated: 9_999, activeStudents: 10_000 }),
      });
    });

    it('applies the import when the admin confirms the mass deactivation', async () => {
      const massive = { ...summary, deactivated: 9_999 };
      vi.mocked(studentRepo.importPadron).mockResolvedValue(massive);

      const result = await importPadron(
        Buffer.from(''),
        { confirmDeactivation: true },
        actor
      );
      expect(result).toEqual(massive);
    });

    // Un cierre de semestre normal no debe pedir confirmación.
    it('applies the import when deactivations stay under the threshold', async () => {
      vi.mocked(studentRepo.importPadron).mockResolvedValue({ ...summary, deactivated: 300 });

      await expect(importPadron(Buffer.from(''), {}, actor)).resolves.toMatchObject({
        deactivated: 300,
      });
    });

    it('uses the mapping confirmed by the admin', async () => {
      vi.mocked(readXlsxFile).mockResolvedValue([
        {
          sheet: 'Hoja1',
          data: [
            ['col1', 'col2', 'col3', 'col4'],
            ['2021001234', 'Ana García', 'viejo@tec.cr', 'nuevo@tec.cr'],
          ],
        },
      ] as any);

      await importPadron(
        Buffer.from(''),
        { mapping: { carnet: 0, full_name: 1, email: 3 } },
        actor
      );

      const rows = vi.mocked(studentRepo.importPadron).mock.calls[0][0] as any[];
      expect(rows[0].Correo).toBe('nuevo@tec.cr');
    });
  });

  // ── Umbral de bajas ────────────────────────────────────────────────────────

  describe('requiresDeactivationConfirmation', () => {
    it('no molesta con las bajas normales de un cierre de semestre', () => {
      expect(requiresDeactivationConfirmation(300, 10_282)).toBe(false);
    });

    it('exige confirmación cuando el archivo vacía el padrón', () => {
      expect(requiresDeactivationConfirmation(10_282, 10_282)).toBe(true);
    });

    // Un tope absoluto alto nunca se alcanzaria aqui y dejaria pasar un borrado
    // del 96% del padron sin avisar.
    it('protege también a un padrón pequeño', () => {
      expect(requiresDeactivationConfirmation(43, 45)).toBe(true);
    });

    it('ignora las bajas de unos pocos registros', () => {
      expect(requiresDeactivationConfirmation(3, 45)).toBe(false);
      expect(requiresDeactivationConfirmation(0, 10_282)).toBe(false);
    });
  });

  // ── analyzePadron ──────────────────────────────────────────────────────────

  describe('analyzePadron', () => {
    const summary = { total: 1, new: 1, updated: 0, reactivated: 0, deactivated: 9_999 };

    beforeEach(() => {
      vi.mocked(readXlsxFile).mockResolvedValue([
        {
          sheet: 'Hoja1',
          data: [
            [],
            [],
            [],
            ['carne', 'nombre', 'correo', 'sede', 'carrera', 'grado'],
            ['2024302905', 'Brenes Molina Marcela', 'm.brenes.4@estudiantec.cr', 'Cartago', 'Mantenimiento', '119410055'],
          ],
        },
      ] as any);
      vi.mocked(studentRepo.importPadron).mockResolvedValue(summary);
      vi.mocked(studentRepo.countActiveStudents).mockResolvedValue(10_282);
      vi.mocked(studentRepo.findStudentCatalog).mockResolvedValue({ sedes: [], careers: [] });
    });

    it('returns the detected mapping and the diff without applying it', async () => {
      const result = await analyzePadron(Buffer.from(''), {}, actor);

      expect(result.headerRowIndex).toBe(3);
      expect(result.mapping).toMatchObject({ carnet: 0, full_name: 1, email: 2 });
      expect(result.validRows).toBe(1);
      expect(result.diff).toEqual(summary);
      expect(result.requiresConfirmation).toBe(true);
      // El diff se calcula en una transacción que se revierte.
      expect(withAuditContextDryRun).toHaveBeenCalled();
      expect(withAuditContext).not.toHaveBeenCalled();
    });

    it('skips the dry run when required columns are missing', async () => {
      vi.mocked(readXlsxFile).mockResolvedValue([
        { sheet: 'Hoja1', data: [['grado'], ['Bachillerato']] },
      ] as any);

      const result = await analyzePadron(Buffer.from(''), {}, actor);

      expect(result.diff).toBeNull();
      expect(result.missingRequired).toEqual(expect.arrayContaining(['carnet', 'email']));
      expect(withAuditContextDryRun).not.toHaveBeenCalled();
    });

    it('rejects a file that cannot be read as xlsx', async () => {
      vi.mocked(readXlsxFile).mockRejectedValue(new Error('not a zip'));

      await expect(analyzePadron(Buffer.from(''), {}, actor)).rejects.toMatchObject({
        code: 'PADRON_FILE_UNREADABLE',
      });
    });
  });

  // ── getAllAdmins ───────────────────────────────────────────────────────────

  describe('getAllAdmins', () => {
    it('returns all admins from repository', async () => {
      vi.mocked(adminRepo.findAllAdmins).mockResolvedValue([mockAdmin]);
      const result = await getAllAdmins();
      expect(result).toEqual([mockAdmin]);
    });

    it('returns empty array when no admins exist', async () => {
      vi.mocked(adminRepo.findAllAdmins).mockResolvedValue([]);
      const result = await getAllAdmins();
      expect(result).toEqual([]);
    });
  });

  // ── getAdminById ───────────────────────────────────────────────────────────

  describe('getAdminById', () => {
    it('returns admin when found', async () => {
      vi.mocked(adminRepo.findAdminById).mockResolvedValue(mockAdmin);
      const result = await getAdminById('admin-uuid-1');
      expect(result).toEqual(mockAdmin);
    });

    it('throws when admin not found', async () => {
      vi.mocked(adminRepo.findAdminById).mockResolvedValue(null);
      await expect(getAdminById('nonexistent')).rejects.toThrow('Admin no encontrado');
    });
  });

  // ── createAdmin ────────────────────────────────────────────────────────────

  describe('createAdmin', () => {
    const newAdminData = { students_id: 'student-uuid-1', position_title: 'VP' };

    beforeEach(() => {
      vi.mocked(adminRepo.findAdminByStudentId).mockResolvedValue(null);
      vi.mocked(adminRepo.createAdmin).mockResolvedValue(mockAdmin);
    });

    it('creates admin and returns record', async () => {
      const result = await createAdmin(newAdminData, actor);
      expect(result).toEqual(mockAdmin);
      expect(adminRepo.createAdmin).toHaveBeenCalledWith(newAdminData, mockClient);
    });

    it('throws when student is already an admin', async () => {
      vi.mocked(adminRepo.findAdminByStudentId).mockResolvedValue(mockAdmin);
      await expect(createAdmin(newAdminData, actor)).rejects.toThrow('Este estudiante ya es admin');
    });

    it('calls withAuditContext with actor data', async () => {
      await createAdmin(newAdminData, actor);
      expect(withAuditContext).toHaveBeenCalledWith(
        { id: actor.id, carnet: actor.carnet, ip: actor.ip },
        expect.any(Function)
      );
    });
  });

  // ── updateAdmin ────────────────────────────────────────────────────────────

  describe('updateAdmin', () => {
    it('updates admin and returns updated record', async () => {
      vi.mocked(adminRepo.updateAdmin).mockResolvedValue({ ...mockAdmin, position_title: 'Director' });
      const result = await updateAdmin('admin-uuid-1', { position_title: 'Director' }, actor);
      expect(result.position_title).toBe('Director');
      expect(adminRepo.updateAdmin).toHaveBeenCalledWith(
        'admin-uuid-1',
        { position_title: 'Director' },
        mockClient
      );
    });

    it('throws when admin not found', async () => {
      vi.mocked(adminRepo.updateAdmin).mockResolvedValue(null);
      await expect(updateAdmin('nonexistent', { role: 'x' }, actor)).rejects.toThrow('Admin no encontrado');
    });
  });

  // ── deleteAdmin ────────────────────────────────────────────────────────────

  describe('deleteAdmin', () => {
    const otherAdmin: Admin = { ...mockAdmin, id: 'admin-uuid-2' };

    beforeEach(() => {
      vi.mocked(adminRepo.countAdmins).mockResolvedValue(2);
      vi.mocked(adminRepo.findFirstAdmin).mockResolvedValue(otherAdmin);
      vi.mocked(adminRepo.deleteAdmin).mockResolvedValue(mockAdmin);
    });

    it('deletes admin and returns deleted record', async () => {
      const result = await deleteAdmin('admin-uuid-1', actor);
      expect(result).toEqual(mockAdmin);
      expect(adminRepo.deleteAdmin).toHaveBeenCalledWith('admin-uuid-1', mockClient);
    });

    it('throws when there is only one admin left', async () => {
      vi.mocked(adminRepo.countAdmins).mockResolvedValue(1);
      await expect(deleteAdmin('admin-uuid-1', actor)).rejects.toThrow(
        'Debe existir al menos un administrador'
      );
    });

    it('throws when trying to delete the first admin', async () => {
      vi.mocked(adminRepo.findFirstAdmin).mockResolvedValue(mockAdmin);
      await expect(deleteAdmin('admin-uuid-1', actor)).rejects.toThrow(
        'El primer administrador no se puede eliminar'
      );
    });

    it('throws when admin id not found in db', async () => {
      vi.mocked(adminRepo.deleteAdmin).mockResolvedValue(null);
      await expect(deleteAdmin('admin-uuid-1', actor)).rejects.toThrow('Admin no encontrado');
    });

    it('passes client to all repo calls inside the transaction', async () => {
      await deleteAdmin('admin-uuid-1', actor);
      expect(adminRepo.countAdmins).toHaveBeenCalledWith(mockClient);
      expect(adminRepo.findFirstAdmin).toHaveBeenCalledWith(mockClient);
      expect(adminRepo.deleteAdmin).toHaveBeenCalledWith('admin-uuid-1', mockClient);
    });
  });
});
