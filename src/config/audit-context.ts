import { pool } from './database';
import { PoolClient } from 'pg';

export interface AuditActor {
  id?: string;
  carnet?: string;
  ip?: string;
}

async function runWithAuditContext<T>(
  actor: AuditActor,
  fn: (client: PoolClient) => Promise<T>,
  commit: boolean
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

    await client.query(commit ? 'COMMIT' : 'ROLLBACK');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Ejecuta un callback dentro de una transacción con variables de sesión de auditoría definidas.
 * Todos los triggers que se disparen dentro de esta transacción tomarán la información del actor.
 */
export async function withAuditContext<T>(
  actor: AuditActor,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  return runWithAuditContext(actor, fn, true);
}

/**
 * Igual que `withAuditContext`, pero cierra siempre con ROLLBACK.
 *
 * Sirve para simular una operación y quedarse solo con lo que devuelve: la base
 * queda intacta, incluidas las filas que escriban los triggers de auditoría. Lo
 * usa la vista previa del import del padrón para calcular cuántos estudiantes se
 * crearían, actualizarían o desactivarían antes de aplicar nada.
 */
export async function withAuditContextDryRun<T>(
  actor: AuditActor,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  return runWithAuditContext(actor, fn, false);
}
