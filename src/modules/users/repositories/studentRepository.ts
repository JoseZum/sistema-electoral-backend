import { pool } from '../../../config/database';
import { PoolClient } from 'pg';
import { Student } from '../models/userModel';
import { CreateStudentDto, UpdateStudentDto, StudentFiltersDto } from '../dtos/studentDtos';

// Buscar estudiante por email
export async function findStudentByEmail(email: string): Promise<Student | null> {
  const result = await pool.query<Student>(
    'SELECT * FROM students WHERE email = $1 AND is_active = true',
    [email]
  );
  return result.rows[0] || null;
}

// Buscar estudiante por carnet
export async function findStudentByCarnet(carnet: string): Promise<Student | null> {
  const result = await pool.query<Student>(
    'SELECT * FROM students WHERE carnet = $1 AND is_active = true',
    [carnet]
  );
  return result.rows[0] || null;
}

// Buscar estudiante por ID
export async function findStudentById(id: string): Promise<Student | null> {
  const result = await pool.query<Student>(
    'SELECT * FROM students WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

export async function findStudentCatalog(): Promise<{ sedes: string[]; careers: string[] }> {
  const [sedesResult, careersResult] = await Promise.all([
    pool.query<{ sede: string }>(
      `SELECT DISTINCT sede
       FROM students
       WHERE is_active = true
         AND sede IS NOT NULL
         AND sede <> ''
       ORDER BY sede ASC`
    ),
    pool.query<{ career: string }>(
      `SELECT DISTINCT career
       FROM students
       WHERE is_active = true
         AND career IS NOT NULL
         AND career <> ''
       ORDER BY career ASC`
    ),
  ]);

  return {
    sedes: sedesResult.rows.map((row) => row.sede),
    careers: careersResult.rows.map((row) => row.career),
  };
}

// Listar estudiantes con filtros y paginación
export async function findAllStudents(filters: StudentFiltersDto = {}): Promise<{ students: Student[]; total: number }> {
  const { sede, career, is_active, search, page = 1, limit = 50 } = filters;
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (sede) {
    conditions.push(`sede ILIKE $${paramIndex++}`);
    params.push(sede);
  }
  if (career) {
    conditions.push(`career ILIKE $${paramIndex++}`);
    params.push(career);
  }
  if (is_active !== undefined) {
    conditions.push(`is_active = $${paramIndex++}`);
    params.push(is_active);
  }
  if (search) {
    conditions.push(`(full_name ILIKE $${paramIndex} OR carnet ILIKE $${paramIndex} OR email ILIKE $${paramIndex})`);
    params.push(`%${search}%`);
    paramIndex++;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*) FROM students ${where}`,
    params
  );

  const result = await pool.query<Student>(
    `SELECT * FROM students ${where} ORDER BY full_name ASC LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
    [...params, limit, offset]
  );

  return {
    students: result.rows,
    total: parseInt(countResult.rows[0].count, 10),
  };
}

// Crear estudiante
export async function createStudent(data: CreateStudentDto): Promise<Student> {
  const result = await pool.query<Student>(
    `INSERT INTO students (carnet, full_name, email, sede, career, degree_level)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [data.carnet, data.full_name, data.email, data.sede, data.career, data.degree_level]
  );
  return result.rows[0];
}

// Actualizar estudiante
export async function updateStudent(id: string, data: UpdateStudentDto): Promise<Student | null> {
  const fields: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (data.full_name !== undefined) { fields.push(`full_name = $${paramIndex++}`); params.push(data.full_name); }
  if (data.email !== undefined) { fields.push(`email = $${paramIndex++}`); params.push(data.email); }
  if (data.sede !== undefined) { fields.push(`sede = $${paramIndex++}`); params.push(data.sede); }
  if (data.career !== undefined) { fields.push(`career = $${paramIndex++}`); params.push(data.career); }
  if (data.degree_level !== undefined) { fields.push(`degree_level = $${paramIndex++}`); params.push(data.degree_level); }
  if (data.is_active !== undefined) { fields.push(`is_active = $${paramIndex++}`); params.push(data.is_active); }

  if (fields.length === 0) return findStudentById(id);

  fields.push(`updated_at = now()`);

  const result = await pool.query<Student>(
    `UPDATE students SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    [...params, id]
  );
  return result.rows[0] || null;
}

// Desactivar estudiante (soft delete)
export async function deactivateStudent(id: string): Promise<Student | null> {
  const result = await pool.query<Student>(
    'UPDATE students SET is_active = false, updated_at = now() WHERE id = $1 RETURNING *',
    [id]
  );
  return result.rows[0] || null;
}

// Importar padrón usando function (accepts a client for audit context)
export async function importPadron(
  data: Record<string, unknown>[],
  client?: PoolClient
): Promise<{
  total: number;
  new: number;
  updated: number;
  reactivated: number;
  deactivated: number;
}> {
  const db = client || pool;
  const result = await db.query(
    'SELECT fn_import_students($1::jsonb) as summary',
    [JSON.stringify(data)]
  );
  return result.rows[0].summary;
}
