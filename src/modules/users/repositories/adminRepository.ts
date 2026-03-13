import { pool } from '../../../config/database';
import { Admin } from '../models/userModel';
import { CreateAdminDto, UpdateAdminDto } from '../dtos/adminDtos';

// Buscar admin por ID
export async function findAdminById(id: string): Promise<Admin | null> {
  const result = await pool.query<Admin>(
    'SELECT * FROM admins WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

// Buscar admin por student ID (para verificar si un estudiante es admin)
export async function findAdminByStudentId(studentId: string): Promise<Admin | null> {
  const result = await pool.query<Admin>(
    'SELECT * FROM admins WHERE students_id = $1 AND is_active = true',
    [studentId]
  );
  return result.rows[0] || null;
}

// Listar todos los admins
export async function findAllAdmins(): Promise<Admin[]> {
  const result = await pool.query<Admin>(
    'SELECT * FROM admins WHERE is_active = true ORDER BY created_at DESC'
  );
  return result.rows;
}

// Crear admin
export async function createAdmin(data: CreateAdminDto): Promise<Admin> {
  const result = await pool.query<Admin>(
    `INSERT INTO admins (students_id, position_title, role, permissions)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [data.students_id, data.position_title, data.role || 'member', JSON.stringify(data.permissions || {})]
  );
  return result.rows[0];
}

// Actualizar admin
export async function updateAdmin(id: string, data: UpdateAdminDto): Promise<Admin | null> {
  const fields: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (data.position_title !== undefined) { fields.push(`position_title = $${paramIndex++}`); params.push(data.position_title); }
  if (data.role !== undefined) { fields.push(`role = $${paramIndex++}`); params.push(data.role); }
  if (data.permissions !== undefined) { fields.push(`permissions = $${paramIndex++}`); params.push(JSON.stringify(data.permissions)); }
  if (data.is_active !== undefined) { fields.push(`is_active = $${paramIndex++}`); params.push(data.is_active); }

  if (fields.length === 0) return findAdminById(id);

  fields.push(`updated_at = now()`);

  const result = await pool.query<Admin>(
    `UPDATE admins SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    [...params, id]
  );
  return result.rows[0] || null;
}

// Desactivar admin (soft delete)
export async function deactivateAdmin(id: string): Promise<Admin | null> {
  const result = await pool.query<Admin>(
    'UPDATE admins SET is_active = false, updated_at = now() WHERE id = $1 RETURNING *',
    [id]
  );
  return result.rows[0] || null;
}
