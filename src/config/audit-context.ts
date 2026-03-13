import { pool } from './database';
import { PoolClient } from 'pg';

interface AuditActor {
  carnet?: string;
  ip?: string;
}

/**
 * Runs a callback inside a transaction with audit session variables set.
 * All triggers that fire within this transaction will pick up the actor info.
 */
export async function withAuditContext<T>(
  actor: AuditActor,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (actor.carnet) {
      await client.query(`SET LOCAL app.actor_carnet = '${actor.carnet.replace(/'/g, "''")}'`);
    }
    if (actor.ip) {
      await client.query(`SET LOCAL app.client_ip = '${actor.ip.replace(/'/g, "''")}'`);
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
