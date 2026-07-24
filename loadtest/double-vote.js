/**
 * Prueba de INTEGRIDAD bajo contencion (k6): ataque de doble voto.
 *
 * Muchas peticiones simultaneas usando el MISMO token de votante contra /cast.
 * Resultado esperado: EXACTAMENTE 1 aceptada (200), el resto rechazadas (409), 0 errores.
 * Demuestra que ni bajo martilleo concurrente se cuela un segundo voto.
 *
 * Requisitos: seed.mjs corrido + backend arriba (misma BD local + JWT_SECRET).
 * Ejecutar:  k6 run loadtest/double-vote.js
 *   Opcionales:  -e VUS=50 -e ITER=4 -e TARGET_INDEX=0
 */

import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';

const voters = new SharedArray('voters', () => JSON.parse(open('./voters.json')));
const meta = JSON.parse(open('./meta.json'));

const votesOk = new Counter('votes_ok');
const votesConflict = new Counter('votes_conflict');
const votesError = new Counter('votes_error');

const TARGET_INDEX = Number(__ENV.TARGET_INDEX || 0);

export const options = {
  scenarios: {
    doble_voto: {
      executor: 'per-vu-iterations',
      vus: Number(__ENV.VUS || 50),
      iterations: Number(__ENV.ITER || 4),
      maxDuration: '2m',
    },
  },
  thresholds: {
    // El corazon de la prueba: solo UN voto puede entrar, pase lo que pase.
    votes_ok: ['count==1'],
    votes_error: ['count==0'],
  },
};

export default function () {
  const voter = voters[TARGET_INDEX];
  if (!voter) return;

  const res = http.post(
    `${meta.baseUrl}/api/voting/cast`,
    JSON.stringify({ electionId: meta.electionId, optionId: meta.optionId }),
    { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${voter.token}` } }
  );

  if (res.status === 200) votesOk.add(1);
  else if (res.status === 409) votesConflict.add(1);
  else if (res.status !== 429) votesError.add(1);

  check(res, {
    'respuesta 200 o 409 (sin doble voto)': (r) => r.status === 200 || r.status === 409,
  });
}
