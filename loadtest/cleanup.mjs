/**
 * Borra los datos sembrados por seed.mjs (segun ids.json). SEGURIDAD: solo BD local.
 * Uso: node loadtest/cleanup.mjs
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import pg from 'pg';
import { assertSafeTarget } from './guard.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env.loadtest') });

const DATABASE_URL = process.env.DATABASE_URL || '';
assertSafeTarget(DATABASE_URL);

const { electionId, studentIds } = JSON.parse(readFileSync(join(__dirname, 'ids.json'), 'utf8'));
const { Pool } = pg;
const pool = new Pool({ connectionString: DATABASE_URL, max: 5 });

async function main() {
  await pool.query('DELETE FROM votes WHERE election_id = $1', [electionId]);
  await pool.query('DELETE FROM voting_tokens WHERE election_id = $1', [electionId]);
  await pool.query('DELETE FROM election_voters WHERE election_id = $1', [electionId]);
  await pool.query('DELETE FROM election_options WHERE election_id = $1', [electionId]);
  await pool.query('DELETE FROM elections WHERE id = $1', [electionId]);
  await pool.query('DELETE FROM students WHERE id = ANY($1::uuid[])', [studentIds]);
  await pool.end();
  console.log(`[OK] Limpieza completa: eleccion ${electionId} y ${studentIds.length} votantes borrados.`);
}

main().catch((err) => {
  console.error('[ERROR] Fallo la limpieza:', err.message);
  process.exit(1);
});
