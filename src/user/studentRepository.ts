import { pool } from '../config/database';
import { Student } from './userModel';

export async function findStudentByEmail(email: string): Promise<Student | null> {
  const result = await pool.query<Student>(
    'SELECT * FROM students WHERE email = $1 AND is_active = true',
    [email]
  );
  return result.rows[0] || null;
}

export async function findStudentByCarnet(carnet: string): Promise<Student | null> {
  const result = await pool.query<Student>(
    'SELECT * FROM students WHERE carnet = $1 AND is_active = true',
    [carnet]
  );
  return result.rows[0] || null;
}
