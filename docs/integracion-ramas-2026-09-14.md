# Integración de ramas pendientes

Las ramas de padrón, postulaciones, dashboard y Aaron ya eran ancestros de `dev` al revisar el repositorio. Las referencias locales `dev` y `main` estaban atrasadas respecto a GitHub.

| Rama | Revisión | Resolución |
| --- | --- | --- |
| `feature/monitoreo` | `3caf9f6` | Se incorpora la participación agregada por sede; el endpoint reutiliza las restricciones actuales de monitoreo y la validación de UUID. Se conserva el seed actual. |
| `feature/emailsending` | `7ae85a7` | Se incorporó el módulo de correos. **Revertido el 19 de septiembre de 2026:** ver abajo. |
| `plan-de-pruebas` | `8f5ee03` | Sus casos de autenticación, dashboard, elecciones y votación ya están cubiertos por las suites actuales bajo `tests/unit` y `tests/integration`; el healthcheck está en `tests/e2e/auth/auth.spec.ts`. No se reincorporan reportes generados ni pruebas del flujo de códigos de acceso que fue sustituido por el diseño actual de voto anónimo. |

La integración conserva las ramas originales como referencia. Los commits históricos de una integración por contenido no pasan a ser ancestros de `dev`; esto no indica que falte su funcionalidad.

## Correos: revertido

El módulo de notificaciones se elimina el 19 de septiembre de 2026. `POST /api/notifications/send` enviaba correo real, uno por uno, a cada votante activo de una elección: miles de personas del padrón institucional a partir de una sola petición. Nunca fue solicitado ni aprobado por el TEE; entró porque la rama estaba pendiente de integrar, y estar pendiente no es estar aprobado.

Se eliminan el módulo, su ruta, sus pruebas, las variables `SMTP_*` del ejemplo de entorno y la dependencia `nodemailer`. Si alguna vez hace falta avisar al padrón, tiene que diseñarse con aprobación escrita del TEE, control de quién dispara el envío y registro en auditoría — ninguna de las tres cosas existía aquí.

## Publicación

Los PR de cambios apuntan a `dev`. La pipeline de `dev` ejecuta las pruebas y los controles de seguridad antes de promover el commit comprobado a `main`. No se realiza push manual a `main` ni se omiten controles para completar una integración.
