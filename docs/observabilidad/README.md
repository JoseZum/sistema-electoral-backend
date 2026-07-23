# Observabilidad con Grafana

El backend envía métricas y trazas mediante OTLP únicamente cuando
`OTEL_EXPORTER_OTLP_ENDPOINT` está configurada. Los logs estructurados se escriben en
stdout/stderr para que la plataforma los transporte a Loki.

## Seguridad y privacidad

- Nunca configurar tokens OTLP en archivos versionados.
- No registrar cuerpos, detalles de errores, query strings, correos, carnés ni tokens.
- Las trazas reemplazan los query strings por `[REDACTED]`.
- En producción se recomienda Grafana Cloud; el compose incluido es solo para desarrollo.

## Prueba local

Desde la raíz del backend:

```powershell
docker compose -f observability/docker-compose.observability.yml up -d
```

Configurar temporalmente en `.env`:

```env
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=tee-voting-backend
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=local
OBSERVABILITY_ENABLED=true
```

Ejecutar `npm run dev`, generar tráfico y abrir Grafana en
`http://localhost:3002`. El contenedor local usa `admin/admin`; está limitado a
`127.0.0.1`.

Para importar el dashboard:

1. Abrir **Dashboards → New → Import**.
2. Subir `observability/grafana/dashboards/electoral.json`.
3. Seleccionar el datasource Prometheus incluido en LGTM.

## Producción

Crear un stack de Grafana Cloud y configurar en Vercel, únicamente con scope
Production:

```env
OTEL_EXPORTER_OTLP_ENDPOINT=https://<region>.grafana.net/otlp
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic <credencial-generada-por-grafana>
OTEL_SERVICE_NAME=tee-voting-backend
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production
OTEL_METRIC_EXPORT_INTERVAL=15000
OBSERVABILITY_ENABLED=true
```

Antes de promover:

1. Desplegar en Preview con credenciales separadas.
2. Confirmar métricas en Prometheus/Mimir, trazas en Tempo y logs en Loki.
3. Verificar que ninguna señal contiene query strings, correo, carné o tokens.
4. Ejecutar `npm run typecheck`, `npm run build`, `npm test -- --run` y
   `npm run test:security`.

La exportación periódica puede perder el último intervalo si una función serverless
se congela inmediatamente. La prueba Preview debe confirmar el comportamiento bajo
tráfico representativo antes de producción.
