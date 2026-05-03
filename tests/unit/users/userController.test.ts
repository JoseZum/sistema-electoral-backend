import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';

vi.mock('../../../src/modules/users/services/userService');

import * as userService from '../../../src/modules/users/services/userService';
import {
  getStudents,
  getStudentCatalog,
  getStudentById,
  createStudent,
  updateStudent,
  deleteStudent,
  importPadron,
  getAdmins,
  getAdminById,
  createAdmin,
  updateAdmin,
  deleteAdmin,
} from '../../../src/modules/users/controllers/userController';
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

function makeRes(): Response {
  const res = {} as any;
  res.json = vi.fn().mockReturnValue(res);
  res.status = vi.fn().mockReturnValue(res);
  return res as Response;
}

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    params: {},
    query: {},
    body: {},
    headers: {},
    user: undefined,
    ip: undefined,
    socket: { remoteAddress: undefined },
    file: undefined,
    ...overrides,
  } as unknown as Request;
}

function makeNext(): NextFunction {
  return vi.fn() as unknown as NextFunction;
}

describe('userController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── getStudents ────────────────────────────────────────────────────────────

  describe('getStudents', () => {
    it('responds with students from service', async () => {
      vi.mocked(userService.getAllStudents).mockResolvedValue({ students: [mockStudent], total: 1 });
      const res = makeRes();
      await getStudents(makeReq(), res, makeNext());
      expect(res.json).toHaveBeenCalledWith({ students: [mockStudent], total: 1 });
    });

    it('passes parsed filters to the service', async () => {
      vi.mocked(userService.getAllStudents).mockResolvedValue({ students: [], total: 0 });
      const req = makeReq({ query: { sede: 'Central', career: 'Computación', search: 'Ana', page: '2', limit: '10' } });
      await getStudents(req, makeRes(), makeNext());
      expect(userService.getAllStudents).toHaveBeenCalledWith({
        sede: 'Central',
        career: 'Computación',
        is_active: true,
        search: 'Ana',
        page: 2,
        limit: 10,
      });
    });

    it('defaults is_active to true when not provided', async () => {
      vi.mocked(userService.getAllStudents).mockResolvedValue({ students: [], total: 0 });
      await getStudents(makeReq({ query: {} }), makeRes(), makeNext());
      const filters = vi.mocked(userService.getAllStudents).mock.calls[0][0];
      expect(filters.is_active).toBe(true);
    });

    it('parses is_active=false as boolean false', async () => {
      vi.mocked(userService.getAllStudents).mockResolvedValue({ students: [], total: 0 });
      await getStudents(makeReq({ query: { is_active: 'false' } }), makeRes(), makeNext());
      const filters = vi.mocked(userService.getAllStudents).mock.calls[0][0];
      expect(filters.is_active).toBe(false);
    });

    it('passes page and limit as integers', async () => {
      vi.mocked(userService.getAllStudents).mockResolvedValue({ students: [], total: 0 });
      await getStudents(makeReq({ query: { page: '3', limit: '20' } }), makeRes(), makeNext());
      const filters = vi.mocked(userService.getAllStudents).mock.calls[0][0];
      expect(filters.page).toBe(3);
      expect(filters.limit).toBe(20);
    });

    it('calls next with error when service throws', async () => {
      vi.mocked(userService.getAllStudents).mockRejectedValue(new Error('DB error'));
      const next = makeNext();
      await getStudents(makeReq(), makeRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  // ── getStudentCatalog ──────────────────────────────────────────────────────

  describe('getStudentCatalog', () => {
    it('responds with catalog from service', async () => {
      const catalog = { sedes: ['Central'], careers: ['Computación'] };
      vi.mocked(userService.getStudentCatalog).mockResolvedValue(catalog);
      const res = makeRes();
      await getStudentCatalog(makeReq(), res, makeNext());
      expect(res.json).toHaveBeenCalledWith(catalog);
    });

    it('calls next with error when service throws', async () => {
      vi.mocked(userService.getStudentCatalog).mockRejectedValue(new Error('DB error'));
      const next = makeNext();
      await getStudentCatalog(makeReq(), makeRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  // ── getStudentById ─────────────────────────────────────────────────────────

  describe('getStudentById', () => {
    it('responds with student from service', async () => {
      vi.mocked(userService.getStudentById).mockResolvedValue(mockStudent);
      const res = makeRes();
      await getStudentById(makeReq({ params: { id: 'student-uuid-1' } }), res, makeNext());
      expect(userService.getStudentById).toHaveBeenCalledWith('student-uuid-1');
      expect(res.json).toHaveBeenCalledWith(mockStudent);
    });

    it('calls next with error when service throws', async () => {
      vi.mocked(userService.getStudentById).mockRejectedValue(new Error('Estudiante no encontrado'));
      const next = makeNext();
      await getStudentById(makeReq({ params: { id: 'bad-id' } }), makeRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  // ── createStudent ──────────────────────────────────────────────────────────

  describe('createStudent', () => {
    it('responds with 201 and created student', async () => {
      vi.mocked(userService.createStudent).mockResolvedValue(mockStudent);
      const res = makeRes();
      await createStudent(makeReq({ body: { carnet: '2021001234' } }), res, makeNext());
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(mockStudent);
    });

    it('passes req.body to the service', async () => {
      vi.mocked(userService.createStudent).mockResolvedValue(mockStudent);
      const body = { carnet: '2021001234', full_name: 'Ana' };
      await createStudent(makeReq({ body }), makeRes(), makeNext());
      expect(userService.createStudent).toHaveBeenCalledWith(body, expect.any(Object));
    });

    it('builds actor from req.user and req.ip', async () => {
      vi.mocked(userService.createStudent).mockResolvedValue(mockStudent);
      const req = makeReq({
        body: {},
        user: { studentId: 'admin-uuid', carnet: '2021000000' } as any,
        ip: '10.0.0.1',
      });
      await createStudent(req, makeRes(), makeNext());
      expect(userService.createStudent).toHaveBeenCalledWith(
        expect.anything(),
        { id: 'admin-uuid', carnet: '2021000000', ip: '10.0.0.1' }
      );
    });

    it('extracts first IP from x-forwarded-for string', async () => {
      vi.mocked(userService.createStudent).mockResolvedValue(mockStudent);
      const req = makeReq({
        body: {},
        headers: { 'x-forwarded-for': '192.168.1.1, 10.0.0.1' },
      });
      await createStudent(req, makeRes(), makeNext());
      expect(userService.createStudent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ ip: '192.168.1.1' })
      );
    });

    it('extracts first IP from x-forwarded-for array', async () => {
      vi.mocked(userService.createStudent).mockResolvedValue(mockStudent);
      const req = makeReq({
        body: {},
        headers: { 'x-forwarded-for': ['172.16.0.1', '10.0.0.1'] as any },
      });
      await createStudent(req, makeRes(), makeNext());
      expect(userService.createStudent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ ip: '172.16.0.1' })
      );
    });

    it('falls back to req.socket.remoteAddress when no ip headers present', async () => {
      vi.mocked(userService.createStudent).mockResolvedValue(mockStudent);
      const req = makeReq({ body: {}, socket: { remoteAddress: '127.0.0.1' } as any });
      await createStudent(req, makeRes(), makeNext());
      expect(userService.createStudent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ ip: '127.0.0.1' })
      );
    });

    it('calls next with error when service throws', async () => {
      vi.mocked(userService.createStudent).mockRejectedValue(new Error('Email duplicado'));
      const next = makeNext();
      await createStudent(makeReq(), makeRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  // ── updateStudent ──────────────────────────────────────────────────────────

  describe('updateStudent', () => {
    it('responds with updated student', async () => {
      vi.mocked(userService.updateStudent).mockResolvedValue(mockStudent);
      const res = makeRes();
      const req = makeReq({ params: { id: 'student-uuid-1' }, body: { sede: 'Alajuela' } });
      await updateStudent(req, res, makeNext());
      expect(userService.updateStudent).toHaveBeenCalledWith('student-uuid-1', { sede: 'Alajuela' }, expect.any(Object));
      expect(res.json).toHaveBeenCalledWith(mockStudent);
    });

    it('calls next with error when service throws', async () => {
      vi.mocked(userService.updateStudent).mockRejectedValue(new Error('Estudiante no encontrado'));
      const next = makeNext();
      await updateStudent(makeReq({ params: { id: 'bad-id' } }), makeRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  // ── deleteStudent ──────────────────────────────────────────────────────────

  describe('deleteStudent', () => {
    it('responds with deactivated student', async () => {
      const inactive = { ...mockStudent, is_active: false };
      vi.mocked(userService.deactivateStudent).mockResolvedValue(inactive);
      const res = makeRes();
      await deleteStudent(makeReq({ params: { id: 'student-uuid-1' } }), res, makeNext());
      expect(userService.deactivateStudent).toHaveBeenCalledWith('student-uuid-1', expect.any(Object));
      expect(res.json).toHaveBeenCalledWith(inactive);
    });

    it('calls next with error when service throws', async () => {
      vi.mocked(userService.deactivateStudent).mockRejectedValue(new Error('Estudiante no encontrado'));
      const next = makeNext();
      await deleteStudent(makeReq({ params: { id: 'bad-id' } }), makeRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  // ── importPadron ───────────────────────────────────────────────────────────

  describe('importPadron', () => {
    it('responds with import summary when file is provided', async () => {
      const summary = { total: 5, new: 3, updated: 1, reactivated: 1, deactivated: 0 };
      vi.mocked(userService.importPadron).mockResolvedValue(summary);
      const res = makeRes();
      const req = makeReq({ file: { buffer: Buffer.from('') } as any });
      await importPadron(req, res, makeNext());
      expect(userService.importPadron).toHaveBeenCalledWith(expect.any(Buffer), expect.any(Object));
      expect(res.json).toHaveBeenCalledWith(summary);
    });

    it('responds 400 when no file is provided', async () => {
      const res = makeRes();
      await importPadron(makeReq({ file: undefined }), res, makeNext());
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Se requiere un archivo XLSX' });
      expect(userService.importPadron).not.toHaveBeenCalled();
    });

    it('calls next with error when service throws', async () => {
      vi.mocked(userService.importPadron).mockRejectedValue(new Error('Archivo inválido'));
      const next = makeNext();
      await importPadron(makeReq({ file: { buffer: Buffer.from('') } as any }), makeRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  // ── getAdmins ──────────────────────────────────────────────────────────────

  describe('getAdmins', () => {
    it('responds with all admins from service', async () => {
      vi.mocked(userService.getAllAdmins).mockResolvedValue([mockAdmin]);
      const res = makeRes();
      await getAdmins(makeReq(), res, makeNext());
      expect(res.json).toHaveBeenCalledWith([mockAdmin]);
    });

    it('calls next with error when service throws', async () => {
      vi.mocked(userService.getAllAdmins).mockRejectedValue(new Error('DB error'));
      const next = makeNext();
      await getAdmins(makeReq(), makeRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  // ── getAdminById ───────────────────────────────────────────────────────────

  describe('getAdminById', () => {
    it('responds with admin from service', async () => {
      vi.mocked(userService.getAdminById).mockResolvedValue(mockAdmin);
      const res = makeRes();
      await getAdminById(makeReq({ params: { id: 'admin-uuid-1' } }), res, makeNext());
      expect(userService.getAdminById).toHaveBeenCalledWith('admin-uuid-1');
      expect(res.json).toHaveBeenCalledWith(mockAdmin);
    });

    it('calls next with error when service throws', async () => {
      vi.mocked(userService.getAdminById).mockRejectedValue(new Error('Admin no encontrado'));
      const next = makeNext();
      await getAdminById(makeReq({ params: { id: 'bad-id' } }), makeRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  // ── createAdmin ────────────────────────────────────────────────────────────

  describe('createAdmin', () => {
    it('responds with 201 and created admin', async () => {
      vi.mocked(userService.createAdmin).mockResolvedValue(mockAdmin);
      const res = makeRes();
      await createAdmin(makeReq({ body: { students_id: 'student-uuid-1', position_title: 'VP' } }), res, makeNext());
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(mockAdmin);
    });

    it('passes req.body and actor to the service', async () => {
      vi.mocked(userService.createAdmin).mockResolvedValue(mockAdmin);
      const body = { students_id: 'student-uuid-1', position_title: 'VP' };
      const req = makeReq({
        body,
        user: { studentId: 'admin-uuid-1', carnet: '2021000000' } as any,
        ip: '10.0.0.1',
      });
      await createAdmin(req, makeRes(), makeNext());
      expect(userService.createAdmin).toHaveBeenCalledWith(body, {
        id: 'admin-uuid-1',
        carnet: '2021000000',
        ip: '10.0.0.1',
      });
    });

    it('calls next with error when service throws', async () => {
      vi.mocked(userService.createAdmin).mockRejectedValue(new Error('Ya es admin'));
      const next = makeNext();
      await createAdmin(makeReq(), makeRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  // ── updateAdmin ────────────────────────────────────────────────────────────

  describe('updateAdmin', () => {
    it('responds with updated admin', async () => {
      vi.mocked(userService.updateAdmin).mockResolvedValue(mockAdmin);
      const res = makeRes();
      const req = makeReq({ params: { id: 'admin-uuid-1' }, body: { position_title: 'Director' } });
      await updateAdmin(req, res, makeNext());
      expect(userService.updateAdmin).toHaveBeenCalledWith(
        'admin-uuid-1',
        { position_title: 'Director' },
        expect.any(Object)
      );
      expect(res.json).toHaveBeenCalledWith(mockAdmin);
    });

    it('calls next with error when service throws', async () => {
      vi.mocked(userService.updateAdmin).mockRejectedValue(new Error('Admin no encontrado'));
      const next = makeNext();
      await updateAdmin(makeReq({ params: { id: 'bad-id' } }), makeRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  // ── deleteAdmin ────────────────────────────────────────────────────────────

  describe('deleteAdmin', () => {
    it('responds with deleted admin', async () => {
      vi.mocked(userService.deleteAdmin).mockResolvedValue(mockAdmin);
      const res = makeRes();
      await deleteAdmin(makeReq({ params: { id: 'admin-uuid-1' } }), res, makeNext());
      expect(userService.deleteAdmin).toHaveBeenCalledWith('admin-uuid-1', expect.any(Object));
      expect(res.json).toHaveBeenCalledWith(mockAdmin);
    });

    it('calls next with error when service throws', async () => {
      vi.mocked(userService.deleteAdmin).mockRejectedValue(new Error('No se puede eliminar'));
      const next = makeNext();
      await deleteAdmin(makeReq({ params: { id: 'admin-uuid-1' } }), makeRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});
