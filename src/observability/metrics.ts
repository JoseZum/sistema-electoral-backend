/**
 * Metricas de aplicacion y de dominio electoral (OpenTelemetry Metrics API).
 *
 * Todas las funciones son SEGURAS con la observabilidad apagada: si no hay un
 * MeterProvider global registrado (porque telemetry.ts no arranco), la API de OTel
 * devuelve instrumentos no-op y estas llamadas no hacen nada ni fallan.
 *
 * REGLA ANTI-PII: los atributos (labels) NUNCA deben contener identificadores de
 * votante (student_id, email, carnet, token_hash). Solo dimensiones de baja
 * cardinalidad y no identificatorias (election_id, codigo de error, ruta, etc.).
 * De lo contrario se reintroduciria por telemetria la des-anonimizacion que el
 * sistema evita por diseno.
 */

import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('tee-voting-backend');

// --- Instrumentos tecnicos (golden signals) ---

const httpServerDuration = meter.createHistogram('tee.http.server.duration', {
  description: 'Duracion de las peticiones HTTP atendidas por el backend',
  unit: 'ms',
});

const appErrorsTotal = meter.createCounter('tee.app.errors', {
  description: 'Errores de aplicacion normalizados (AppError) por codigo y status',
});

// --- Instrumentos de dominio electoral ---

const votesCastTotal = meter.createCounter('tee.votes.cast', {
  description: 'Votos emitidos con exito (tras confirmacion de la base de datos)',
});

export interface HttpMetricAttrs {
  [key: string]: string | number;
  http_method: string;
  route: string;
  status_code: number;
  status_class: string;
}

export function recordHttpRequest(attrs: HttpMetricAttrs, durationMs: number): void {
  httpServerDuration.record(durationMs, attrs);
}

export interface AppErrorAttrs {
  [key: string]: string | number;
  code: string;
  status: number;
}

export function recordAppError(attrs: AppErrorAttrs): void {
  appErrorsTotal.add(1, attrs);
}

export interface VoteCastAttrs {
  [key: string]: string;
  election_id: string;
  anonymous: string; // 'true' | 'false'
  mode: string; // 'single' | 'suboption'
}

export function recordVoteCast(attrs: VoteCastAttrs): void {
  votesCastTotal.add(1, attrs);
}

/**
 * Registra gauges observables del pool de conexiones pg. Critico en serverless,
 * donde cada instancia abre pocas conexiones y el agotamiento del limite de
 * Postgres es el riesgo #1 bajo carga de votacion.
 *
 * Se le pasa el pool para no crear una dependencia circular con config/database.
 */
export function registerDbPoolMetrics(pool: {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
}): void {
  const total = meter.createObservableGauge('tee.db.pool.total', {
    description: 'Conexiones totales en el pool pg (activas + idle)',
  });
  const idle = meter.createObservableGauge('tee.db.pool.idle', {
    description: 'Conexiones idle en el pool pg',
  });
  const waiting = meter.createObservableGauge('tee.db.pool.waiting', {
    description: 'Peticiones esperando una conexion del pool pg (saturacion)',
  });

  total.addCallback((observer) => observer.observe(pool.totalCount));
  idle.addCallback((observer) => observer.observe(pool.idleCount));
  waiting.addCallback((observer) => observer.observe(pool.waitingCount));
}
