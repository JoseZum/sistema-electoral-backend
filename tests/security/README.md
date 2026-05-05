# Security tests

## OWASP ZAP API Scan

El backend incluye un escaneo DAST para API con OWASP ZAP y la especificacion
OpenAPI de `tests/security/openapi.json`.

Requisitos:

- Docker disponible.
- Ejecutar contra datos de prueba. El active scan puede enviar `POST`, `PUT` y `DELETE`.

## Local desde la raiz del proyecto

```powershell
docker compose --profile security run --rm zap-api-scan
```

Este flujo usa el `docker-compose.yml` raiz y reutiliza el backend/postgres local.

## Local o CI desde `sistema-electoral-backend`

```powershell
docker compose -f docker-compose.security.yml up --build --abort-on-container-exit --exit-code-from zap-api-scan zap-api-scan
```

Tambien existe el script npm, pero internamente delega a ese Docker Compose:

```powershell
npm run test:security:zap
```

Este flujo es autocontenido para GitHub Actions porque levanta postgres, backend y
ZAP desde `docker-compose.security.yml`.

## Endpoints autenticados

```powershell
$env:ZAP_AUTH_TOKEN="<jwt-de-prueba>"
docker compose --profile security run --rm zap-api-scan
```

En GitHub Actions, definir `ZAP_AUTH_TOKEN` como secret o variable del workflow si
se quiere que ZAP explore rutas protegidas con un JWT valido.

## Variables utiles

- `ZAP_TARGET_BASE_URL`: URL base del backend vista desde el contenedor ZAP. Por defecto usa `http://backend:3001`.
- `ZAP_AUTH_TOKEN`: JWT opcional. El runner lo inyecta como `Authorization: Bearer <token>`.
- `ZAP_SAFE_MODE=true`: ejecuta ZAP sin active scan.
- `ZAP_FAIL_ON_WARNINGS=true`: falla tambien con hallazgos `WARN`.
- `ZAP_DEBUG=true`: habilita salida detallada.

## Reportes generados

- `tests/security/reports/zap-api-report.html`
- `tests/security/reports/zap-api-report.json`
- `tests/security/reports/zap-api-report.md`
- `tests/security/reports/zap-api-report.xml`
