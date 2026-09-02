/**
 * Prueba de CAPACIDAD (k6): busca el punto de quiebre, no la aprobacion.
 *
 * A diferencia de vote-load.js — que confirma que N votos pasan — este escenario sube la tasa
 * de llegada por escalones y sigue empujando aunque el sistema se degrade, para responder
 * "cuantas peticiones por segundo aguanta antes de romperse y COMO se rompe".
 *
 * Usa 'ramping-arrival-rate': mantiene la tasa objetivo aunque suba la latencia (arranca VUs
 * nuevos si hace falta). Es la diferencia clave con un test de VUs fijos, donde el propio
 * sistema lento frena la carga y esconde el limite real.
 *
 * Clasifica los fallos por CAUSA, que es lo que importa en serverless:
 *   - db_conn_errors  -> agotamiento de conexiones de Postgres (el techo esperado en Supabase)
 *   - timeouts        -> la peticion nunca volvio (funcion agotada o cola en el pooler)
 *   - other_errors    -> cualquier otro 5xx
 *
 * Los votantes se reciclan: al agotar el padron sembrado las respuestas pasan a 409 (ya voto),
 * que ejercita el MISMO stored procedure y la misma conexion. Para medir capacidad sirve igual.
 *
 * Ejecutar:  k6 run loadtest/capacity.js
 *   Opcionales:  -e PEAK=200      tasa maxima a alcanzar (req/s)
 *                -e STAGE=30s     duracion de cada escalon
 *                -e MAX_VUS=500   techo de VUs que k6 puede arrancar
 */

import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';
import exec from 'k6/execution';

const voters = new SharedArray('voters', () => JSON.parse(open('./voters.json')));
const meta = JSON.parse(open('./meta.json'));

const votesOk = new Counter('votes_ok');
const votesConflict = new Counter('votes_conflict');
const votesRateLimited = new Counter('votes_ratelimited');
const dbConnErrors = new Counter('db_conn_errors');
const timeouts = new Counter('timeouts');
const otherErrors = new Counter('other_errors');

const PEAK = Number(__ENV.PEAK || 200);
const STAGE = __ENV.STAGE || '30s';

// Escalones hasta PEAK. Se mantiene cada uno un rato para que la degradacion se estabilice
// antes de subir: un pico instantaneo mide el arranque, no la capacidad sostenida.
function ramp() {
  const fractions = [0.025, 0.05, 0.125, 0.25, 0.5, 0.75, 1];
  return fractions
    .map((fraction) => Math.max(1, Math.round(PEAK * fraction)))
    .map((target) => ({ target, duration: STAGE }));
}

export const options = {
  scenarios: {
    capacidad: {
      executor: 'ramping-arrival-rate',
      startRate: 1,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: Number(__ENV.MAX_VUS || 500),
      stages: ramp(),
      gracefulStop: '30s',
    },
  },
  // Sin umbrales que aborten: aqui el objetivo es LLEGAR al fallo y verlo, no evitarlo.
  thresholds: {
    http_req_duration: ['p(95)<1500'],
  },
};

export default function () {
  const voter = voters[exec.scenario.iterationInTest % voters.length];
  if (!voter) return;

  const res = http.post(
    `${meta.baseUrl}/api/voting/cast`,
    JSON.stringify({ electionId: meta.electionId, optionId: meta.optionId }),
    {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${voter.token}` },
      timeout: '30s',
    }
  );

  if (res.status === 200) {
    votesOk.add(1);
  } else if (res.status === 409) {
    votesConflict.add(1);
  } else if (res.status === 429) {
    votesRateLimited.add(1);
  } else if (res.status === 0) {
    // k6 usa status 0 cuando la peticion no llego a completarse.
    timeouts.add(1);
  } else {
    const body = String(res.body || '');
    const agotoConexiones =
      body.includes('too many connections') ||
      body.includes('remaining connection slots') ||
      body.includes('Connection terminated') ||
      body.includes('ECONNREFUSED');

    if (agotoConexiones) dbConnErrors.add(1);
    else otherErrors.add(1);
  }

  check(res, {
    'sin error de servidor (5xx)': (r) => r.status !== 0 && r.status < 500,
  });
}
