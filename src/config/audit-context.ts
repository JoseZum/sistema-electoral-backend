import { pool } from './database';
import { PoolClient } from 'pg';

export interface AuditActor {
  id?: string;
  carnet?: string;
  ip?: string;
}

/**
 * Ejecuta un callback dentro de una transacción con variables de sesión de auditoría definidas.
 * Todos los triggers que se disparen dentro de esta transacción tomarán la información del actor.
 */
export async function withAuditContext<T>(
  actor: AuditActor,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (actor.id) {
      await client.query(`SELECT set_config('app.actor_id', $1, true)`, [actor.id]);
    }
    if (actor.carnet) {
      await client.query(`SELECT set_config('app.actor_carnet', $1, true)`, [actor.carnet]);
    }
    if (actor.ip) {
      await client.query(`SELECT set_config('app.client_ip', $1, true)`, [actor.ip]);
    }

    const result = await fn(client);

    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
