import { pool } from '../config/database';
import { TeeMember } from './userModel';

export async function findTeeMemberByCarnet(carnet: string): Promise<TeeMember | null> {
  const result = await pool.query<TeeMember>(
    'SELECT * FROM tee_members WHERE carnet = $1 AND is_active = true',
    [carnet]
  );
  return result.rows[0] || null;
}
