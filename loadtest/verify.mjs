/**
 * Verificacion de INTEGRIDAD ELECTORAL tras una prueba de carga (fuente de verdad: la BD).
 *
 * Comprueba, para la eleccion sembrada (ids.json):
 *   1. Ningun votante tiene mas de 1 voto (sin doble voto).
 *   2. En eleccion anonima, ningun voto guarda student_id (secreto del voto).
 *   3. El numero de votos == numero de votantes marcados como token_used.
 *   4. Total de votos <= padron elegible.
 *
 * SEGURIDAD: aborta si DATABASE_URL no es local.
 * Sale con codigo != 0 si alguna comprobacion falla.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env.loadtest') });

const DATABASE_URL = process.env.DATABASE_URL || '';
const isLocal = /(@|\/\/)(localhost|127\.0\.0\.1|postgres)(:|\/)/i.test(DATABASE_URL);
const looksRemote = /supabase\.(co|com)|pooler\.supabase|amazonaws|neon\.tech|render\.com|azure/i.test(
  DATABASE_URL
);
if (!DATABASE_URL || !isLocal || looksRemote) {
  console.error('[ABORTADO] DATABASE_URL no es local.');
  process.exit(1);
}

const { electionId } = JSON.parse(readFileSync(join(__dirname, 'ids.json'), 'utf8'));
const { Pool } = pg;
const pool = new Pool({ connectionString: DATABASE_URL, max: 5 });

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  const isAnon = (
    await pool.query('SELECT is_anonymous FROM elections WHERE id = $1', [electionId])
  ).rows[0]?.is_anonymous;

  const totalVotes = Number(
    (await pool.query('SELECT COUNT(*)::int AS c FROM votes WHERE election_id = $1', [electionId]))
      .rows[0].c
  );

  const dupStudents = Number(
    (
      await pool.query(
        `SELECT COUNT(*)::int AS c FROM (
           SELECT student_id FROM votes
           WHERE election_id = $1 AND student_id IS NOT NULL
           GROUP BY student_id HAVING COUNT(*) > 1
         ) t`,
        [electionId]
      )
    ).rows[0].c
  );

  const dupTokens = Number(
    (
      await pool.query(
        `SELECT COUNT(*)::int AS c FROM (
           SELECT token_hash FROM votes
           WHERE election_id = $1 AND token_hash IS NOT NULL
           GROUP BY token_hash HAVING COUNT(*) > 1
         ) t`,
        [electionId]
      )
    ).rows[0].c
  );

  const votersUsed = Number(
    (
      await pool.query(
        'SELECT COUNT(*)::int AS c FROM election_voters WHERE election_id = $1 AND token_used = true',
        [electionId]
      )
    ).rows[0].c
  );

  const eligible = Number(
    (
      await pool.query('SELECT COUNT(*)::int AS c FROM election_voters WHERE election_id = $1', [
        electionId,
      ])
    ).rows[0].c
  );

  const votesWithIdentity = Number(
    (
      await pool.query(
        'SELECT COUNT(*)::int AS c FROM votes WHERE election_id = $1 AND student_id IS NOT NULL',
        [electionId]
      )
    ).rows[0].c
  );

  console.log(`\nEleccion ${electionId} (${isAnon ? 'anonima' : 'nominal'})`);
  console.log(`Votos: ${totalVotes} | Votantes marcados: ${votersUsed} | Padron: ${eligible}\n`);

  check('Sin doble voto por votante (nominal)', dupStudents === 0, `${dupStudents} duplicados`);
  check('Sin doble uso de token (anonimo)', dupTokens === 0, `${dupTokens} duplicados`);
  check(
    'Votos == votantes marcados como token_used',
    totalVotes === votersUsed,
    `${totalVotes} vs ${votersUsed}`
  );
  check('Total de votos <= padron elegible', totalVotes <= eligible, `${totalVotes} <= ${eligible}`);
  if (isAnon) {
    check(
      'Secreto del voto: ningun voto guarda identidad',
      votesWithIdentity === 0,
      `${votesWithIdentity} votos con student_id`
    );
  }

  await pool.end();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${failed.length === 0 ? 'INTEGRIDAD OK ✅' : `FALLARON ${failed.length} CHEQUEOS ❌`}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[ERROR] Fallo la verificacion:', err.message);
  process.exit(1);
});
