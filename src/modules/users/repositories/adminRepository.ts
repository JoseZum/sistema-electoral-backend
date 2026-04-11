import { pool } from '../../../config/database';
import { PoolClient } from 'pg';
import { Admin } from '../models/userModel';
import { CreateAdminDto, UpdateAdminDto } from '../dtos/adminDtos';

type Queryable = PoolClient | typeof pool;

function getDb(client?: PoolClient): Queryable {
  return client || pool;
}

export async function findAdminById(id: string): Promise<Admin | null> {
  const result = await pool.query<Admin>(
    'SELECT * FROM admins WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

export async function findAdminByStudentId(studentId: string): Promise<Admin | null> {
  const result = await pool.query<Admin>(
    'SELECT * FROM admins WHERE students_id = $1',
    [studentId]
  );
  return result.rows[0] || null;
}

export async function findAllAdmins() {
  const result = await pool.query(
    `SELECT a.id, a.students_id, a.position_title, a.role, a.permissions, a.created_at, a.updated_at,
            s.carnet, s.full_name, s.sede, s.career
     FROM admins a
     JOIN students s ON a.students_id = s.id
     ORDER BY a.created_at DESC`
  );
  return result.rows;
}

export async function countAdmins(client?: PoolClient): Promise<number> {
  const db = getDb(client);
  const result = await db.query<{ count: string }>('SELECT COUNT(*) AS count FROM admins');
  return parseInt(result.rows[0].count, 10);
}

export async function findFirstAdmin(client?: PoolClient): Promise<Admin | null> {
  const db = getDb(client);
  const result = await db.query<Admin>(
    'SELECT * FROM admins ORDER BY created_at ASC, id ASC LIMIT 1'
  );
  return result.rows[0] || null;
}

export async function createAdmin(data: CreateAdminDto, client?: PoolClient): Promise<Admin> {
  const db = getDb(client);
  const result = await db.query<Admin>(
    `INSERT INTO admins (students_id, position_title, role, permissions)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [data.students_id, data.position_title, data.role || 'admin', JSON.stringify(data.permissions || {})]
  );
  return result.rows[0];
}

export async function updateAdmin(id: string, data: UpdateAdminDto, client?: PoolClient): Promise<Admin | null> {
  const fields: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (data.position_title !== undefined) {
    fields.push(`position_title = $${paramIndex++}`);
    params.push(data.position_title);
  }
  if (data.role !== undefined) {
    fields.push(`role = $${paramIndex++}`);
    params.push(data.role);
  }
  if (data.permissions !== undefined) {
    fields.push(`permissions = $${paramIndex++}`);
    params.push(JSON.stringify(data.permissions));
  }

  if (fields.length === 0) {
    return findAdminById(id);
  }

  fields.push('updated_at = now()');

  const db = getDb(client);
  const result = await db.query<Admin>(
    `UPDATE admins SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    [...params, id]
  );
  return result.rows[0] || null;
}

export async function deleteAdmin(id: string, client?: PoolClient): Promise<Admin | null> {
  const db = getDb(client);
  const result = await db.query<Admin>(
    'DELETE FROM admins WHERE id = $1 RETURNING *',
    [id]
  );
  return result.rows[0] || null;
}
