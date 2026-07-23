import { Pool } from 'pg';
import { env } from './env';
import { logger } from '../observability/logger';
import { registerDbPoolMetrics } from '../observability/metrics';

export const pool = new Pool({
  connectionString: env.databaseUrl,
  ssl: env.databaseSsl
    ? {
        rejectUnauthorized: env.databaseSslRejectUnauthorized,
      }
    : false,
  max: env.databasePoolMax,
});

pool.on('error', (err) => {
  logger.error('Error inesperado en el pool de base de datos', {
    error: err instanceof Error ? err.message : String(err),
  });
});

// Gauges observables del pool (total/idle/waiting). No-op si la observabilidad esta apagada.
registerDbPoolMetrics(pool);
