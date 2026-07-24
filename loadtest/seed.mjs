/**
 * Siembra datos AISLADOS para pruebas de carga con k6.
 *
 * Crea: 1 eleccion OPEN (nominal o anonima), 1 opcion, N estudiantes en el padron y sus
 * filas en election_voters. Genera un JWT de sesion valido por votante (firmado con el mismo
 * JWT_SECRET que usa el backend) y escribe:
 *   - loadtest/voters.json  -> [{ email, studentId, token }]
 *   - loadtest/meta.json    -> { baseUrl, electionId, optionId, mode, count }
 *   - loadtest/ids.json     -> { electionId, optionId, studentIds } (para cleanup)
 *
 * SEGURIDAD: aborta si DATABASE_URL no es local (bloquea Supabase/produccion).
 *
 * Uso:
 *   node loadtest/seed.mjs
 * (lee loadtest/.env.loadtest; sobreescribe con variables de entorno si quieres)
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import pg from 'pg';
import jwt from 'jsonwebtoken';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env.loadtest') });

const DATABASE_URL = process.env.DATABASE_URL || '';
const JWT_SECRET = process.env.JWT_SECRET || '';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const VOTERS = parseInt(process.env.VOTERS || '1000', 10);
const MODE = (process.env.ELECTION_MODE || 'named').toLowerCase();

// --- Guarda de seguridad: SOLO base de datos local ---
const isLocal = /(@|\/\/)(localhost|127\.0\.0\.1|postgres)(:|\/)/i.test(DATABASE_URL);
const looksRemote = /supabase\.(co|com)|pooler\.supabase|amazonaws|neon\.tech|render\.com|azure/i.test(
  DATABASE_URL
);
if (!DATABASE_URL || !isLocal || looksRemote) {
  console.error(
    '\n[ABORTADO] DATABASE_URL no parece local. Las pruebas de carga jamas deben correr contra produccion.\n' +
      `DATABASE_URL actual: ${DATABASE_URL.replace(/:[^:@/]+@/, ':***@')}\n` +
      'Configura loadtest/.env.loadtest con un Postgres local (localhost:5432).\n'
  );
  process.exit(1);
}
if (!JWT_SECRET) {
  console.error('[ABORTADO] Falta JWT_SECRET (debe coincidir con el del backend bajo prueba).');
  process.exit(1);
}

const { Pool } = pg;
const pool = new Pool({ connectionString: DATABASE_URL, max: 10 });

function mintToken(student) {
  return jwt.sign(
    {
      studentId: student.id,
      carnet: student.carnet,
      email: student.email,
      fullName: student.full_name,
      role: 'voter',
    },
    JWT_SECRET,
    { expiresIn: '8h', issuer: 'tee-voting-system' }
  );
}

async function main() {
  const stamp = Date.now().toString(36);
  const electionId = crypto.randomUUID();
  const optionId = crypto.randomUUID();
  const isAnonymous = MODE === 'anonymous';

  // La eleccion debe estar OPEN AHORA: start en el pasado, end en el futuro para que
  // syncAutomaticStatuses no la cierre.
  const start = new Date(Date.now() - 60 * 60 * 1000);
  const end = new Date(Date.now() + 6 * 60 * 60 * 1000);

  const students = Array.from({ length: VOTERS }, (_, i) => ({
    id: crypto.randomUUID(),
    carnet: `LT${stamp}${String(i).padStart(6, '0')}`.slice(0, 20),
    full_name: `Votante Carga ${i + 1}`,
    email: `loadtest-${stamp}-${i}@estudiantec.cr`,
  }));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO elections (id, title, status, is_anonymous, auth_method, voter_source,
         requires_keys, min_keys, start_time, end_time)
       VALUES ($1,$2,'OPEN'::election_status,$3,'MICROSOFT','MANUAL'::voter_source_type,false,1,$4,$5)`,
      [electionId, `Prueba de carga ${stamp}`, isAnonymous, start, end]
    );

    await client.query(
      `INSERT INTO election_options (id, election_id, label, option_type, display_order)
       VALUES ($1,$2,'Opcion de carga','ticket',1)`,
      [optionId, electionId]
    );

    // Inserta estudiantes y votantes en lotes con UNNEST (rapido para miles de filas).
    const CHUNK = 500;
    for (let start = 0; start < students.length; start += CHUNK) {
      const chunk = students.slice(start, start + CHUNK);
      await client.query(
        `INSERT INTO students (id, carnet, full_name, email, sede, career, degree_level, is_active)
         SELECT * FROM UNNEST($1::uuid[],$2::text[],$3::text[],$4::text[],
           $5::text[],$6::text[],$7::text[],$8::boolean[])`,
        [
          chunk.map((s) => s.id),
          chunk.map((s) => s.carnet),
          chunk.map((s) => s.full_name),
          chunk.map((s) => s.email),
          chunk.map(() => 'Cartago'),
          chunk.map(() => 'Ingenieria en Computacion'),
          chunk.map(() => 'Bachillerato'),
          chunk.map(() => true),
        ]
      );
      await client.query(
        `INSERT INTO election_voters (election_id, student_id, token_used)
         SELECT $1::uuid, s, false FROM UNNEST($2::uuid[]) AS s`,
        [electionId, chunk.map((s) => s.id)]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const voters = students.map((s) => ({ email: s.email, studentId: s.id, token: mintToken(s) }));

  writeFileSync(join(__dirname, 'voters.json'), JSON.stringify(voters));
  writeFileSync(
    join(__dirname, 'meta.json'),
    JSON.stringify({ baseUrl: BASE_URL, electionId, optionId, mode: MODE, count: VOTERS }, null, 2)
  );
  writeFileSync(
    join(__dirname, 'ids.json'),
    JSON.stringify({ electionId, optionId, studentIds: students.map((s) => s.id) })
  );

  console.log(
    `[OK] Sembrado: eleccion ${electionId} (${MODE}, OPEN), ${VOTERS} votantes.\n` +
      `     voters.json / meta.json / ids.json escritos en loadtest/.\n` +
      `     Backend esperado en ${BASE_URL} (mismo JWT_SECRET y misma BD local).`
  );
  await pool.end();
}

main().catch((err) => {
  console.error('[ERROR] Fallo la siembra:', err.message);
  process.exit(1);
});
