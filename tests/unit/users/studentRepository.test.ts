import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  findStudentByEmail,
  findStudentByCarnet,
  findStudentById,
  findStudentCatalog,
  findAllStudents,
  createStudent,
  updateStudent,
  deactivateStudent,
  importPadron,
} from '../../../src/modules/users/repositories/studentRepository';
import { Student } from '../../../src/modules/users/models/userModel';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../../src/config/database', () => ({ pool: mockPool }));

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

function makeClient(rows: unknown[], rowCount = rows.length) {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount }) };
}

describe('studentRepository', () => {
  beforeEach(() => {
    mockPool.query.mockReset();
  });

  describe('findStudentByEmail', () => {
    it('returns student when found by email', async () => {
      mockPool.query.mockResolvedValue({ rows: [mockStudent] });
      const result = await findStudentByEmail('ana.garcia@estudiantec.cr');
      expect(result).toEqual(mockStudent);
      expect(mockPool.query).toHaveBeenCalledWith(expect.any(String), ['ana.garcia@estudiantec.cr']);
    });

    it('returns null when no active student has that email', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });
      const result = await findStudentByEmail('noexiste@estudiantec.cr');
      expect(result).toBeNull();
    });
  });

  describe('findStudentByCarnet', () => {
    it('returns student when found by carnet', async () => {
      mockPool.query.mockResolvedValue({ rows: [mockStudent] });
      const result = await findStudentByCarnet('2021001234');
      expect(result).toEqual(mockStudent);
      expect(mockPool.query).toHaveBeenCalledWith(expect.any(String), ['2021001234']);
    });

    it('returns null when carnet not found', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });
      const result = await findStudentByCarnet('9999999999');
      expect(result).toBeNull();
    });
  });

  describe('findStudentById', () => {
    it('returns student when found by id', async () => {
      mockPool.query.mockResolvedValue({ rows: [mockStudent] });
      const result = await findStudentById('student-uuid-1');
      expect(result).toEqual(mockStudent);
      expect(mockPool.query).toHaveBeenCalledWith(expect.any(String), ['student-uuid-1']);
    });

    it('returns null when id not found', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });
      const result = await findStudentById('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('findStudentCatalog', () => {
    it('returns sedes and careers from distinct active students', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ sede: 'Central' }, { sede: 'Alajuela' }] })
        .mockResolvedValueOnce({ rows: [{ career: 'Computación' }, { career: 'Administración' }] });
      const result = await findStudentCatalog();
      expect(result).toEqual({
        sedes: ['Central', 'Alajuela'],
        careers: ['Computación', 'Administración'],
      });
      expect(mockPool.query).toHaveBeenCalledTimes(2);
    });

    it('returns empty arrays when no active students exist', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });
      const result = await findStudentCatalog();
      expect(result).toEqual({ sedes: [], careers: [] });
    });
  });

  describe('findAllStudents', () => {
    it('returns students and total with no filters', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ count: '1' }] })
        .mockResolvedValueOnce({ rows: [mockStudent] });
      const result = await findAllStudents();
      expect(result).toEqual({ students: [mockStudent], total: 1 });
      expect(mockPool.query).toHaveBeenCalledTimes(2);
    });

    it('applies sede filter to the WHERE clause', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [] });
      await findAllStudents({ sede: 'Central' });
      const countSql: string = mockPool.query.mock.calls[0][0];
      expect(countSql).toContain('WHERE');
      expect(mockPool.query.mock.calls[0][1]).toContain('Central');
    });

    it('applies career filter to the WHERE clause', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [] });
      await findAllStudents({ career: 'Computación' });
      expect(mockPool.query.mock.calls[0][1]).toContain('Computación');
    });

    it('applies is_active filter', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [] });
      await findAllStudents({ is_active: false });
      expect(mockPool.query.mock.calls[0][1]).toContain(false);
    });

    it('wraps search term in wildcards for full_name and carnet', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [] });
      await findAllStudents({ search: 'ana' });
      expect(mockPool.query.mock.calls[0][1]).toContain('%ana%');
    });

    it('uses default page=1 and limit=50 when not provided', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [] });
      await findAllStudents();
      const dataParams = mockPool.query.mock.calls[1][1] as unknown[];
      // last two params are limit and offset
      expect(dataParams.at(-2)).toBe(50);
      expect(dataParams.at(-1)).toBe(0);
    });

    it('calculates correct offset from page and limit', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [] });
      await findAllStudents({ page: 3, limit: 10 });
      const dataParams = mockPool.query.mock.calls[1][1] as unknown[];
      expect(dataParams.at(-2)).toBe(10);
      expect(dataParams.at(-1)).toBe(20);
    });

    it('returns empty students and total 0 when no results', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [] });
      const result = await findAllStudents({ sede: 'Inexistente' });
      expect(result).toEqual({ students: [], total: 0 });
    });
  });

  describe('createStudent', () => {
    it('inserts student and returns created record', async () => {
      const client = makeClient([mockStudent]);
      const data = {
        carnet: '2021001234',
        full_name: 'Ana García',
        email: 'ana.garcia@estudiantec.cr',
        sede: 'Central',
        career: 'Ingeniería en Computación',
        degree_level: 'Bachillerato',
      };
      const result = await createStudent(data, client as any);
      expect(result).toEqual(mockStudent);
      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO students'),
        [data.carnet, data.full_name, data.email, data.sede, data.career, data.degree_level]
      );
    });

    it('uses pool when no client provided', async () => {
      mockPool.query.mockResolvedValue({ rows: [mockStudent] });
      const data = {
        carnet: '2021001234',
        full_name: 'Ana García',
        email: 'ana.garcia@estudiantec.cr',
        sede: 'Central',
        career: 'Computación',
        degree_level: 'Bachillerato',
      };
      const result = await createStudent(data);
      expect(result).toEqual(mockStudent);
      expect(mockPool.query).toHaveBeenCalledOnce();
    });
  });

  describe('updateStudent', () => {
    it('updates full_name and returns updated student', async () => {
      const client = makeClient([{ ...mockStudent, full_name: 'Ana López' }]);
      const result = await updateStudent('student-uuid-1', { full_name: 'Ana López' }, client as any);
      expect(result?.full_name).toBe('Ana López');
      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE students'),
        ['Ana López', 'student-uuid-1']
      );
    });

    it('builds SET clause with multiple fields', async () => {
      const client = makeClient([mockStudent]);
      await updateStudent('student-uuid-1', { sede: 'Alajuela', career: 'Química' }, client as any);
      const sql: string = (client.query.mock.calls[0] as any[])[0];
      expect(sql).toContain('sede = $1');
      expect(sql).toContain('career = $2');
    });

    it('always appends updated_at = now() to the SET clause', async () => {
      const client = makeClient([mockStudent]);
      await updateStudent('student-uuid-1', { email: 'new@tec.cr' }, client as any);
      const sql: string = (client.query.mock.calls[0] as any[])[0];
      expect(sql).toContain('updated_at = now()');
    });

    it('can set is_active to false', async () => {
      const client = makeClient([{ ...mockStudent, is_active: false }]);
      await updateStudent('student-uuid-1', { is_active: false }, client as any);
      const params = (client.query.mock.calls[0] as any[])[1];
      expect(params).toContain(false);
    });

    it('returns null when student not found', async () => {
      const client = makeClient([]);
      const result = await updateStudent('nonexistent', { sede: 'Central' }, client as any);
      expect(result).toBeNull();
    });

    it('falls back to findStudentById when no fields are provided', async () => {
      mockPool.query.mockResolvedValue({ rows: [mockStudent] });
      const result = await updateStudent('student-uuid-1', {});
      expect(result).toEqual(mockStudent);
      expect(mockPool.query).toHaveBeenCalledWith(expect.any(String), ['student-uuid-1']);
    });

    it('uses pool when no client provided', async () => {
      mockPool.query.mockResolvedValue({ rows: [mockStudent] });
      const result = await updateStudent('student-uuid-1', { sede: 'Alajuela' });
      expect(result).toEqual(mockStudent);
      expect(mockPool.query).toHaveBeenCalledOnce();
    });
  });

  describe('deactivateStudent', () => {
    it('sets is_active to false and returns updated student', async () => {
      const inactive = { ...mockStudent, is_active: false };
      const client = makeClient([inactive]);
      const result = await deactivateStudent('student-uuid-1', client as any);
      expect(result?.is_active).toBe(false);
      expect(client.query).toHaveBeenCalledWith(expect.any(String), ['student-uuid-1']);
    });

    it('returns null when student not found', async () => {
      const client = makeClient([]);
      const result = await deactivateStudent('nonexistent', client as any);
      expect(result).toBeNull();
    });

    it('uses pool when no client provided', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ ...mockStudent, is_active: false }] });
      const result = await deactivateStudent('student-uuid-1');
      expect(result?.is_active).toBe(false);
      expect(mockPool.query).toHaveBeenCalledOnce();
    });
  });

  describe('importPadron', () => {
    it('calls fn_import_students and returns summary', async () => {
      const summary = { total: 10, new: 3, updated: 5, reactivated: 1, deactivated: 1 };
      const client = makeClient([{ summary }]);
      const data = [{ carnet: '2021001234', full_name: 'Ana García' }];
      const result = await importPadron(data, client as any);
      expect(result).toEqual(summary);
      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining('fn_import_students'),
        [JSON.stringify(data)]
      );
    });

    it('uses pool when no client provided', async () => {
      const summary = { total: 5, new: 5, updated: 0, reactivated: 0, deactivated: 0 };
      mockPool.query.mockResolvedValue({ rows: [{ summary }] });
      const result = await importPadron([]);
      expect(result).toEqual(summary);
      expect(mockPool.query).toHaveBeenCalledOnce();
    });
  });
});
