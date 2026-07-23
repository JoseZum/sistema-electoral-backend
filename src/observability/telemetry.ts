/**
 * Bootstrap de OpenTelemetry para el backend TEE.
 *
 * DISENO SEGURO / OPT-IN:
 * - La telemetria SOLO se inicializa si existe la variable OTEL_EXPORTER_OTLP_ENDPOINT
 *   (y OBSERVABILITY_ENABLED != 'false'). Sin esa variable el sistema se comporta
 *   exactamente igual que antes: cero coste de arranque y cero dependencias cargadas.
 * - Las dependencias pesadas del SDK se cargan con require() DENTRO del branch habilitado,
 *   por lo que no afectan el cold start cuando la observabilidad esta apagada.
 * - Cualquier fallo al inicializar se captura y se degrada a un warning; NUNCA tumba la app.
 *
 * IMPORTANTE: este modulo debe importarse ANTES que cualquier otro (express, pg, etc.)
 * para que la auto-instrumentacion pueda parchear esos modulos. Por eso es la primera
 * linea de import en src/index.ts.
 *
 * Configuracion via variables de entorno estandar de OTel (las lee el SDK):
 *   OTEL_EXPORTER_OTLP_ENDPOINT   ej: https://otlp-gateway-prod-us-east-0.grafana.net/otlp
 *   OTEL_EXPORTER_OTLP_HEADERS    ej: Authorization=Basic <token-grafana-cloud>
 *   OTEL_SERVICE_NAME             ej: tee-voting-backend
 *   OTEL_RESOURCE_ATTRIBUTES      ej: deployment.environment=production
 */

/* eslint-disable @typescript-eslint/no-var-requires */

const observabilityEnabled =
  Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT) &&
  process.env.OBSERVABILITY_ENABLED !== 'false';

let started = false;

export function isObservabilityEnabled(): boolean {
  return observabilityEnabled;
}

export function startTelemetry(): void {
  if (started || !observabilityEnabled) {
    return;
  }
  started = true;

  try {
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
    const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');
    const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
    const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
    const { ExpressInstrumentation } = require('@opentelemetry/instrumentation-express');
    const { PgInstrumentation } = require('@opentelemetry/instrumentation-pg');

    const metricExportIntervalMillis = parseInt(
      process.env.OTEL_METRIC_EXPORT_INTERVAL || '15000',
      10
    );

    const sdk = new NodeSDK({
      traceExporter: new OTLPTraceExporter(),
      metricReader: new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
        exportIntervalMillis: Number.isNaN(metricExportIntervalMillis)
          ? 15000
          : metricExportIntervalMillis,
      }),
      instrumentations: [
        new HttpInstrumentation({
          requestHook: (span: {
            setAttribute: (name: string, value: string) => void;
          }, request: { url?: string; path?: string }) => {
            // Nunca enviar query strings: pueden contener busquedas por correo/carnet.
            const rawUrl = request.url || request.path || '/';
            const querylessUrl = rawUrl.split(/[?#]/, 1)[0] || '/';
            span.setAttribute('http.target', querylessUrl);
            span.setAttribute('url.path', querylessUrl);
            span.setAttribute('url.query', '[REDACTED]');
            span.setAttribute('url.full', querylessUrl);
          },
        }),
        new ExpressInstrumentation(),
        new PgInstrumentation({
          // Las sentencias SQL pueden contener valores sensibles si no estan parametrizadas.
          // Las metricas del pool cubren diagnostico sin exportar el texto de consultas.
          enhancedDatabaseReporting: false,
        }),
      ],
    });

    sdk.start();
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: 'info',
        msg: 'OpenTelemetry inicializado',
        service: process.env.OTEL_SERVICE_NAME || 'tee-voting-backend',
      })
    );

    // Cierre ordenado en entornos con proceso persistente (local/contenedor).
    // En serverless (Vercel) no llegan estas senales; el flush periodico cubre el caso.
    const shutdown = () => {
      sdk
        .shutdown()
        .catch(() => undefined)
        .finally(() => process.exit(0));
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  } catch (err) {
    // Si faltan dependencias o el endpoint es invalido, NO rompemos la app.
    // eslint-disable-next-line no-console
    console.warn(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: 'warn',
        msg: 'No se pudo inicializar OpenTelemetry; el backend continua sin telemetria',
        error: err instanceof Error ? err.message : String(err),
      })
    );
  }
}

// Efecto de carga: al importarse este modulo (primera linea de src/index.ts) se
// intenta arrancar la telemetria antes de que se carguen express/pg.
startTelemetry();
