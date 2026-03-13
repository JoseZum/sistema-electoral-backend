import { Pool } from 'pg';
import { env } from './env';

export const pool = new Pool({
  connectionString: env.databaseUrl,
});

pool.on('error', (err) => {
  console.error('Error inesperado en el pool de base de datos:', err);
});
