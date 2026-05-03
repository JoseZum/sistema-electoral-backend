import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  findAdminById,
  findAdminByStudentId,
  findAllAdmins,
  countAdmins,
  findFirstAdmin,
  createAdmin,
  updateAdmin,
  deleteAdmin,
} from '../../../src/modules/users/repositories/adminRepository';
import { Admin } from '../../../src/modules/users/models/userModel';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../../src/config/database', () => ({ pool: mockPool }));

const mockAdmin: Admin = {
  id: 'admin-uuid-1',
  students_id: 'student-uuid-1',
  position_title: 'Coordinador',
  role: 'admin',
  permissions: { canEdit: true },
  created_at: new Date('2024-01-01'),
  updated_at: new Date('2024-01-02'),
};

function makeClient(rows: unknown[], rowCount = rows.length) {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount }) };
}

describe('adminRepository', () => {
  beforeEach(() => {
    mockPool.query.mockReset();
  });

  describe('findAdminById', () => {
    it('returns admin when found', async () => {
      mockPool.query.mockResolvedValue({ rows: [mockAdmin] });
      const result = await findAdminById('admin-uuid-1');
      expect(result).toEqual(mockAdmin);
      expect(mockPool.query).toHaveBeenCalledWith(expect.any(String), ['admin-uuid-1']);
    });

    it('returns null when admin not found', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });
      const result = await findAdminById('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('findAdminByStudentId', () => {
    it('returns admin when found by student id', async () => {
      mockPool.query.mockResolvedValue({ rows: [mockAdmin] });
      const result = await findAdminByStudentId('student-uuid-1');
      expect(result).toEqual(mockAdmin);
      expect(mockPool.query).toHaveBeenCalledWith(expect.any(String), ['student-uuid-1']);
    });

    it('returns null when no admin is linked to that student', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });
      const result = await findAdminByStudentId('student-uuid-99');
      expect(result).toBeNull();
    });
  });

  describe('findAllAdmins', () => {
    it('returns all admins with joined student data', async () => {
      const adminRow = { ...mockAdmin, carnet: '2021001234', full_name: 'Ana García', sede: 'Central', career: 'Computación' };
      mockPool.query.mockResolvedValue({ rows: [adminRow] });
      const result = await findAllAdmins();
      expect(result).toEqual([adminRow]);
      expect(mockPool.query).toHaveBeenCalledOnce();
    });

    it('returns empty array when no admins exist', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });
      const result = await findAllAdmins();
      expect(result).toEqual([]);
    });
  });

  describe('countAdmins', () => {
    it('returns count from pool when no client provided', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ count: '3' }] });
      const result = await countAdmins();
      expect(result).toBe(3);
    });

    it('returns count using provided client', async () => {
      const client = makeClient([{ count: '5' }]);
      const result = await countAdmins(client as any);
      expect(result).toBe(5);
      expect(client.query).toHaveBeenCalledOnce();
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('parses count string to integer', async () => {
      const client = makeClient([{ count: '0' }]);
      const result = await countAdmins(client as any);
      expect(result).toBe(0);
    });
  });

  describe('findFirstAdmin', () => {
    it('returns first created admin from pool when no client provided', async () => {
      mockPool.query.mockResolvedValue({ rows: [mockAdmin] });
      const result = await findFirstAdmin();
      expect(result).toEqual(mockAdmin);
    });

    it('returns first admin using provided client', async () => {
      const client = makeClient([mockAdmin]);
      const result = await findFirstAdmin(client as any);
      expect(result).toEqual(mockAdmin);
      expect(client.query).toHaveBeenCalledOnce();
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('returns null when no admins exist', async () => {
      const client = makeClient([]);
      const result = await findFirstAdmin(client as any);
      expect(result).toBeNull();
    });
  });

  describe('createAdmin', () => {
    it('inserts admin and returns created record', async () => {
      const client = makeClient([mockAdmin]);
      const result = await createAdmin({ students_id: 'student-uuid-1', position_title: 'Coordinador' }, client as any);
      expect(result).toEqual(mockAdmin);
      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO admins'),
        ['student-uuid-1', 'Coordinador', 'admin', '{}']
      );
    });

    it('defaults role to "admin" when not provided', async () => {
      const client = makeClient([mockAdmin]);
      await createAdmin({ students_id: 'student-uuid-1', position_title: 'VP' }, client as any);
      const params = (client.query.mock.calls[0] as any[])[1];
      expect(params[2]).toBe('admin');
    });

    it('uses provided role when specified', async () => {
      const client = makeClient([mockAdmin]);
      await createAdmin({ students_id: 'student-uuid-1', position_title: 'VP', role: 'superadmin' }, client as any);
      const params = (client.query.mock.calls[0] as any[])[1];
      expect(params[2]).toBe('superadmin');
    });

    it('serializes permissions to JSON string', async () => {
      const client = makeClient([mockAdmin]);
      const permissions = { canEdit: true, canDelete: false };
      await createAdmin({ students_id: 'student-uuid-1', position_title: 'VP', permissions }, client as any);
      const params = (client.query.mock.calls[0] as any[])[1];
      expect(params[3]).toBe(JSON.stringify(permissions));
    });

    it('defaults permissions to empty object when not provided', async () => {
      const client = makeClient([mockAdmin]);
      await createAdmin({ students_id: 'student-uuid-1', position_title: 'VP' }, client as any);
      const params = (client.query.mock.calls[0] as any[])[1];
      expect(params[3]).toBe('{}');
    });

    it('uses pool when no client provided', async () => {
      mockPool.query.mockResolvedValue({ rows: [mockAdmin] });
      const result = await createAdmin({ students_id: 'student-uuid-1', position_title: 'VP' });
      expect(result).toEqual(mockAdmin);
      expect(mockPool.query).toHaveBeenCalledOnce();
    });
  });

  describe('updateAdmin', () => {
    it('updates position_title and returns updated admin', async () => {
      const client = makeClient([{ ...mockAdmin, position_title: 'Director' }]);
      const result = await updateAdmin('admin-uuid-1', { position_title: 'Director' }, client as any);
      expect(result?.position_title).toBe('Director');
      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE admins'),
        ['Director', 'admin-uuid-1']
      );
    });

    it('updates role when provided', async () => {
      const client = makeClient([{ ...mockAdmin, role: 'superadmin' }]);
      await updateAdmin('admin-uuid-1', { role: 'superadmin' }, client as any);
      const sql: string = (client.query.mock.calls[0] as any[])[0];
      expect(sql).toContain('role = $1');
    });

    it('serializes permissions to JSON when updating permissions', async () => {
      const newPerms = { canDelete: true };
      const client = makeClient([{ ...mockAdmin, permissions: newPerms }]);
      await updateAdmin('admin-uuid-1', { permissions: newPerms }, client as any);
      const params = (client.query.mock.calls[0] as any[])[1];
      expect(params[0]).toBe(JSON.stringify(newPerms));
    });

    it('builds SET clause with multiple fields', async () => {
      const client = makeClient([mockAdmin]);
      await updateAdmin('admin-uuid-1', { position_title: 'X', role: 'y' }, client as any);
      const sql: string = (client.query.mock.calls[0] as any[])[0];
      expect(sql).toContain('position_title = $1');
      expect(sql).toContain('role = $2');
    });

    it('always appends updated_at = now() to the SET clause', async () => {
      const client = makeClient([mockAdmin]);
      await updateAdmin('admin-uuid-1', { position_title: 'X' }, client as any);
      const sql: string = (client.query.mock.calls[0] as any[])[0];
      expect(sql).toContain('updated_at = now()');
    });

    it('returns null when admin not found', async () => {
      const client = makeClient([]);
      const result = await updateAdmin('nonexistent', { role: 'x' }, client as any);
      expect(result).toBeNull();
    });

    it('falls back to findAdminById when no fields are provided', async () => {
      mockPool.query.mockResolvedValue({ rows: [mockAdmin] });
      const result = await updateAdmin('admin-uuid-1', {});
      expect(result).toEqual(mockAdmin);
      expect(mockPool.query).toHaveBeenCalledWith(expect.any(String), ['admin-uuid-1']);
    });
  });

  describe('deleteAdmin', () => {
    it('deletes admin and returns the deleted record', async () => {
      const client = makeClient([mockAdmin]);
      const result = await deleteAdmin('admin-uuid-1', client as any);
      expect(result).toEqual(mockAdmin);
      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM admins'),
        ['admin-uuid-1']
      );
    });

    it('returns null when admin not found', async () => {
      const client = makeClient([]);
      const result = await deleteAdmin('nonexistent', client as any);
      expect(result).toBeNull();
    });

    it('uses pool when no client provided', async () => {
      mockPool.query.mockResolvedValue({ rows: [mockAdmin] });
      const result = await deleteAdmin('admin-uuid-1');
      expect(result).toEqual(mockAdmin);
      expect(mockPool.query).toHaveBeenCalledOnce();
    });
  });
});
