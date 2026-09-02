/**
 * Monitor de la base de datos durante una prueba de carga.
 *
 * Muestrea pg_stat_activity una vez por segundo y escribe un CSV. Es la mitad de la historia
 * que k6 no ve: k6 mide lo que le pasa al CLIENTE (latencia, errores), esto mide lo que pasa
 * DENTRO de Postgres (cuantas conexiones hay realmente abiertas, cuantas esperan un lock,
 * cuantas quedan libres). Sin esto no se puede distinguir "la BD se quedo sin conexiones" de
 * "mi laptop no daba mas".
 *
 * Ojo: el propio monitor consume 1 conexion. Se descuenta en la columna `disponibles`.
 *
 * Uso:
 *   node loadtest/monitor.mjs --out resultados/monitor.csv --label "20 replicas, directa"
 *   (Ctrl+C para terminar; imprime un resumen con los maximos observados.)
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import dotenv from 'dotenv';
import pg from 'pg';
import { assertSafeTarget } from './guard.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env.loadtest') });

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const DATABASE_URL = process.env.DATABASE_URL || '';
const OUT = arg('--out', join(__dirname, 'resultados', 'monitor.csv'));
const LABEL = arg('--label', 'sin-etiqueta');
const INTERVAL_MS = parseInt(arg('--interval', '1000'), 10);

assertSafeTarget(DATABASE_URL);

const { Pool } = pg;
const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 1,
  ssl: /supabase/i.test(DATABASE_URL) ? { rejectUnauthorized: false } : false,
});

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  'ts,etiqueta,max_conn,clientes,activas,idle,idle_in_tx,esperando_lock,disponibles,cpu_host_pct\n'
);

const picos = {
  clientes: 0,
  activas: 0,
  esperando: 0,
  minDisponibles: Number.POSITIVE_INFINITY,
  muestras: 0,
  errores: 0,
  cpuMax: 0,
};

/**
 * % de CPU del host entre muestras. No se usa os.loadavg(): en Windows siempre devuelve 0.
 * Importa para el informe — si la CPU local se satura, las latencias altas son culpa de esta
 * maquina y no de la base de datos, y el resultado no seria valido.
 */
function cpuSnapshot() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    for (const tipo of Object.keys(cpu.times)) total += cpu.times[tipo];
    idle += cpu.times.idle;
  }
  return { idle, total };
}

let cpuPrevio = cpuSnapshot();

function cpuUsoPct() {
  const ahora = cpuSnapshot();
  const deltaIdle = ahora.idle - cpuPrevio.idle;
  const deltaTotal = ahora.total - cpuPrevio.total;
  cpuPrevio = ahora;
  if (deltaTotal <= 0) return 0;
  return (1 - deltaIdle / deltaTotal) * 100;
}

const QUERY = `
  SELECT
    current_setting('max_connections')::int AS max_conn,
    count(*) FILTER (WHERE backend_type = 'client backend')                        AS clientes,
    count(*) FILTER (WHERE backend_type = 'client backend' AND state = 'active')   AS activas,
    count(*) FILTER (WHERE backend_type = 'client backend' AND state = 'idle')     AS idle,
    count(*) FILTER (WHERE backend_type = 'client backend'
                       AND state = 'idle in transaction')                          AS idle_in_tx,
    count(*) FILTER (WHERE wait_event_type = 'Lock')                               AS esperando_lock
  FROM pg_stat_activity`;

async function muestra() {
  try {
    const { rows } = await pool.query(QUERY);
    const r = rows[0];
    // -1: la conexion del propio monitor no cuenta como capacidad util para el backend.
    const disponibles = r.max_conn - r.clientes - 3;
    const cpu = cpuUsoPct();

    appendFileSync(
      OUT,
      `${new Date().toISOString()},${LABEL},${r.max_conn},${r.clientes},${r.activas},` +
        `${r.idle},${r.idle_in_tx},${r.esperando_lock},${disponibles},${cpu.toFixed(1)}\n`
    );

    picos.clientes = Math.max(picos.clientes, Number(r.clientes));
    picos.activas = Math.max(picos.activas, Number(r.activas));
    picos.esperando = Math.max(picos.esperando, Number(r.esperando_lock));
    picos.minDisponibles = Math.min(picos.minDisponibles, disponibles);
    picos.cpuMax = Math.max(picos.cpuMax, cpu);
    picos.muestras += 1;

    process.stdout.write(
      `\r[${LABEL}] clientes=${r.clientes} activas=${r.activas} ` +
        `esperando=${r.esperando_lock} libres=${disponibles} cpu=${cpu.toFixed(0)}%   `
    );
  } catch (err) {
    // Que el monitor no consiga conectarse ES un dato: la BD esta saturada.
    picos.errores += 1;
    appendFileSync(OUT, `${new Date().toISOString()},${LABEL},,,,,,,ERROR:${err.code || err.message}\n`);
    process.stdout.write(`\r[${LABEL}] ERROR de muestreo: ${err.code || err.message}   `);
  }
}

const timer = setInterval(muestra, INTERVAL_MS);
muestra();

async function terminar() {
  clearInterval(timer);
  console.log('\n\n--- Resumen del monitor ---');
  console.log(`  Etiqueta................: ${LABEL}`);
  console.log(`  Muestras................: ${picos.muestras}`);
  console.log(`  Pico de clientes........: ${picos.clientes}`);
  console.log(`  Pico de conexiones activas: ${picos.activas}`);
  console.log(`  Pico esperando lock.....: ${picos.esperando}`);
  console.log(`  Minimo de conexiones libres: ${picos.minDisponibles}`);
  console.log(`  Pico de CPU del host....: ${picos.cpuMax.toFixed(0)}%`);
  console.log(`  Errores de muestreo.....: ${picos.errores}`);
  console.log(`  CSV.....................: ${OUT}\n`);
  await pool.end().catch(() => {});
  process.exit(0);
}

process.on('SIGINT', terminar);
process.on('SIGTERM', terminar);
