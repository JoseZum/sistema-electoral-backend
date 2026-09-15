# Integración de ramas pendientes

Las ramas de padrón, postulaciones, dashboard y Aaron ya eran ancestros de `dev` al revisar el repositorio. Las referencias locales `dev` y `main` estaban atrasadas respecto a GitHub.

| Rama | Revisión | Resolución |
| --- | --- | --- |
| `feature/monitoreo` | `3caf9f6` | Se incorpora la participación agregada por sede; el endpoint reutiliza las restricciones actuales de monitoreo y la validación de UUID. Se conserva el seed actual. |
| `feature/emailsending` | `7ae85a7` | Se incorpora el módulo de correos con validación, permisos administrativos y configuración SMTP externa. Se integra su contenido sin importar el historial que contiene una credencial de prueba. |
| `plan-de-pruebas` | `8f5ee03` | Sus casos de autenticación, dashboard, elecciones y votación ya están cubiertos por las suites actuales bajo `tests/unit` y `tests/integration`; el healthcheck está en `tests/e2e/auth/auth.spec.ts`. No se reincorporan reportes generados ni pruebas del flujo de códigos de acceso que fue sustituido por el diseño actual de voto anónimo. |

La integración conserva las ramas originales como referencia. Los commits históricos de una integración por contenido no pasan a ser ancestros de `dev`; esto no indica que falte su funcionalidad.

## Correos

Configurar `SMTP_HOST`, `SMTP_PORT` (587 por defecto), `SMTP_FROM` y, si el servidor requiere autenticación, `SMTP_USER` y `SMTP_PASS`. El puerto 465 usa TLS desde la conexión; los demás requieren STARTTLS. Sin configuración el endpoint responde 503. Los tests simulan el transporte y no envían correos reales.

`POST /api/notifications/send` admite `reminder`, `open` y `custom`. Los dos primeros requieren una elección abierta; el mensaje personalizado debe tener entre 1 y 5000 caracteres. Se envía a cada votante activo por separado, sin compartir direcciones. Si falla un envío se informa cuántos se completaron, para evitar confundir un envío parcial con éxito total. No se distribuyen tokens de voto por correo.

## Publicación

Los PR de cambios apuntan a `dev`. La pipeline de `dev` ejecuta las pruebas y los controles de seguridad antes de promover el commit comprobado a `main`. No se realiza push manual a `main` ni se omiten controles para completar una integración.
