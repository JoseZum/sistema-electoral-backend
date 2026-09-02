/**
 * Encuentra el TECHO DE CONEXIONES de un Postgres, que es el limite real de un backend
 * serverless: cada instancia de funcion acapara su conexion aunque este idle.
 *
 * Abre conexiones de una en una y las MANTIENE abiertas hasta que el servidor rechaza una.
 * Reporta en cual fallo y con que error — la diferencia entre un rechazo limpio
 * ("too many clients") y un cuelgue importa: el primero devuelve un 500 rapido al votante,
 * el segundo lo deja esperando hasta el timeout de la funcion.
 *
 * A diferencia de levantar N contenedores, esto aisla la variable: no depende de la CPU ni
 * del ancho de banda de la maquina que lo ejecuta, solo de cuantas conexiones concede el
 * servidor. Por eso el resultado SI es transferible a produccion.
 *
 * Uso:
 *   node loadtest/conn-ceiling.mjs --url "<connection string>" --max 120 --label "session"
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import pg from 'pg';
import { assertSafeTarget } from './guard.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const URL_DB = arg('--url', process.env.DATABASE_URL || '');
const MAX = parseInt(arg('--max', '120'), 10);
const LABEL = arg('--label', 'sin-etiqueta');
const OUT = arg('--out', '');

assertSafeTarget(URL_DB);

const { Client } = pg;
const abiertas = [];
let fallo = null;

console.log(`\n[${LABEL}] Abriendo conexiones de una en una (hasta ${MAX})...\n`);

for (let n = 1; n <= MAX; n += 1) {
  const client = new Client({
    connectionString: URL_DB,
    ssl: /supabase/i.test(URL_DB) ? { rejectUnauthorized: false } : false,
    // Si el servidor no responde en 10s lo tratamos como cuelgue, no como rechazo.
    connectionTimeoutMillis: 10000,
  });

  const inicio = Date.now();
  try {
    await client.connect();
    await client.query('SELECT 1');
    abiertas.push(client);
    if (n % 10 === 0) {
      process.stdout.write(`  ${n} conexiones abiertas (${Date.now() - inicio}ms la ultima)\n`);
    }
  } catch (err) {
    fallo = {
      enConexion: n,
      abiertasAntes: abiertas.length,
      codigo: err.code || '(sin codigo)',
      mensaje: err.message,
      msHastaFallo: Date.now() - inicio,
    };
    await client.end().catch(() => {});
    break;
  }
}

console.log('\n--- Resultado ---');
console.log(`  Etiqueta................: ${LABEL}`);
console.log(`  Conexiones simultaneas logradas: ${abiertas.length}`);

if (fallo) {
  console.log(`  Fallo en la conexion....: #${fallo.enConexion}`);
  console.log(`  Codigo de error.........: ${fallo.codigo}`);
  console.log(`  Mensaje.................: ${fallo.mensaje}`);
  console.log(`  Tiempo hasta el fallo...: ${fallo.msHastaFallo}ms`);
  console.log(
    `  Modo de fallo...........: ${
      fallo.msHastaFallo >= 9500 ? 'CUELGUE (el votante espera al timeout)' : 'RECHAZO LIMPIO (error inmediato)'
    }`
  );
} else {
  console.log(`  No se alcanzo el techo dentro de ${MAX} conexiones.`);
}

if (OUT) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ label: LABEL, logradas: abiertas.length, max: MAX, fallo }, null, 2));
  console.log(`  Guardado en.............: ${OUT}`);
}

console.log('');
await Promise.all(abiertas.map((c) => c.end().catch(() => {})));
process.exit(0);
