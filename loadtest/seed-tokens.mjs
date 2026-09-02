/**
 * Genera voters.json / meta.json / ids.json SIN tocar la base de datos.
 *
 * El padron de staging se siembra por SQL con IDs deterministas —  md5('loadtest-'||n)::uuid —
 * asi que aqui se reconstruye la misma lista en Node en vez de leer 10.000 UUIDs de vuelta.
 * Util cuando la siembra se hizo por la API de gestion de Supabase y no hay conexion directa.
 *
 * Debe coincidir EXACTAMENTE con el SQL de siembra; si cambia uno, cambia el otro.
 *
 * Uso:
 *   node loadtest/seed-tokens.mjs
 *     -e VOTERS=10000   nº de votantes (igual al sembrado)
 *     BASE_URL, JWT_SECRET se leen del entorno o de .env.loadtest
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env.loadtest') });

const JWT_SECRET = process.env.JWT_SECRET || '';
const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';
const VOTERS = parseInt(process.env.VOTERS || '10000', 10);

// Deben coincidir con los del SQL de siembra.
const ELECTION_ID = process.env.ELECTION_ID || '11111111-1111-4111-8111-111111111111';
const OPTION_ID = process.env.OPTION_ID || '22222222-2222-4222-8222-222222222222';

if (!JWT_SECRET) {
  console.error('[ABORTADO] Falta JWT_SECRET (debe coincidir con el del backend bajo prueba).');
  process.exit(1);
}

/** Replica de md5('loadtest-'||n)::uuid de Postgres. */
function deterministicId(n) {
  const hex = crypto.createHash('md5').update(`loadtest-${n}`).digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

const voters = [];
const studentIds = [];

for (let n = 1; n <= VOTERS; n += 1) {
  const id = deterministicId(n);
  studentIds.push(id);
  voters.push({
    email: `loadtest-${n}@estudiantec.cr`,
    studentId: id,
    token: jwt.sign(
      {
        studentId: id,
        carnet: `LT${String(n).padStart(8, '0')}`,
        email: `loadtest-${n}@estudiantec.cr`,
        fullName: `Votante Carga ${n}`,
        role: 'voter',
      },
      JWT_SECRET,
      { expiresIn: '24h', issuer: 'tee-voting-system' }
    ),
  });
}

writeFileSync(join(__dirname, 'voters.json'), JSON.stringify(voters));
writeFileSync(
  join(__dirname, 'meta.json'),
  JSON.stringify(
    { baseUrl: BASE_URL, electionId: ELECTION_ID, optionId: OPTION_ID, mode: 'named', count: VOTERS },
    null,
    2
  )
);
writeFileSync(
  join(__dirname, 'ids.json'),
  JSON.stringify({ electionId: ELECTION_ID, optionId: OPTION_ID, studentIds })
);

console.log(
  `[OK] ${VOTERS} tokens generados para ${BASE_URL}\n` +
    `     eleccion ${ELECTION_ID}, opcion ${OPTION_ID}\n` +
    `     primer studentId: ${studentIds[0]}`
);
