import { Pool } from 'pg';
import { env } from './env';

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
  console.error('Error inesperado en el pool de base de datos:', err);
});
