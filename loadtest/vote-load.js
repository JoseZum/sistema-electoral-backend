/**
 * Prueba de carga REALISTA de votacion (k6).
 *
 * Cada votante sembrado emite UN voto. Mide latencia, throughput y clasifica respuestas.
 * Espera: casi todo 200; 0 errores; 0 rechazos por rate limit (un votante legitimo NUNCA
 * deberia ser bloqueado). La correctitud de conteos la valida loadtest/verify.mjs contra la BD.
 *
 * Requisitos: haber corrido `node loadtest/seed.mjs` (genera voters.json y meta.json) y tener
 * el backend arrancado contra la MISMA BD local y el MISMO JWT_SECRET.
 *
 * Ejecutar:  k6 run loadtest/vote-load.js
 *   Variables opcionales:  -e VUS=100   (concurrencia)
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
const votesError = new Counter('votes_error');

export const options = {
  scenarios: {
    eleccion: {
      executor: 'shared-iterations',
      vus: Number(__ENV.VUS || 50),
      iterations: voters.length,
      maxDuration: '10m',
    },
  },
  thresholds: {
    // Un votante legitimo nunca deberia recibir error ni ser bloqueado por rate limit.
    votes_error: ['count==0'],
    votes_ratelimited: ['count==0'],
    http_req_duration: ['p(95)<1500', 'p(99)<3000'],
  },
};

export default function () {
  const i = exec.scenario.iterationInTest;
  const voter = voters[i];
  if (!voter) return;

  const res = http.post(
    `${meta.baseUrl}/api/voting/cast`,
    JSON.stringify({ electionId: meta.electionId, optionId: meta.optionId }),
    { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${voter.token}` } }
  );

  if (res.status === 200) votesOk.add(1);
  else if (res.status === 409) votesConflict.add(1);
  else if (res.status === 429) votesRateLimited.add(1);
  else votesError.add(1);

  check(res, {
    'voto aceptado (200) o ya voto (409)': (r) => r.status === 200 || r.status === 409,
    'sin error de servidor (5xx)': (r) => r.status < 500,
  });
}
