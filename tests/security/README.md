# Security tests

## OWASP ZAP API Scan

El backend incluye un escaneo DAST para API con OWASP ZAP y la especificacion
OpenAPI de `tests/security/openapi.json`.

Requisitos:

- Docker disponible.
- Ejecutar contra datos de prueba. El active scan puede enviar `POST`, `PUT` y `DELETE`.

Comando principal desde la raiz del proyecto:

```powershell
docker compose --profile security run --rm zap-api-scan
```

Tambien existe el script npm desde `sistema-electoral-backend`, pero internamente delega a Docker Compose:

```powershell
npm run test:security:zap
```

Para endpoints autenticados:

```powershell
$env:ZAP_AUTH_TOKEN="<jwt-de-prueba>"
docker compose --profile security run --rm zap-api-scan
```

Variables utiles:

- `ZAP_TARGET_BASE_URL`: URL base del backend vista desde el contenedor ZAP. Por defecto usa `http://backend:3001`.
- `ZAP_AUTH_TOKEN`: JWT opcional. El runner lo inyecta como `Authorization: Bearer <token>`.
- `ZAP_SAFE_MODE=true`: ejecuta ZAP sin active scan.
- `ZAP_FAIL_ON_WARNINGS=true`: falla tambien con hallazgos `WARN`.
- `ZAP_DEBUG=true`: habilita salida detallada.

Reportes generados:

- `tests/security/reports/zap-api-report.html`
- `tests/security/reports/zap-api-report.json`
- `tests/security/reports/zap-api-report.md`
- `tests/security/reports/zap-api-report.xml`
