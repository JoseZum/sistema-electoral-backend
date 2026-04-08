Backend - Sistema Electoral TEE

API REST para gestión de votaciones y autenticación con Microsoft Azure AD.

Stack:
- Node.js 18+
- Express.js
- PostgreSQL
- JWT para sesiones
- Azure AD para autenticación OAuth

Configuración rápida

1. Instalar dependencias:
   npm install

2. Crear archivo .env basado en .env.example:
   cp .env.example .env

3. Configurar variables en .env:

   Puerto y ambiente:
   PORT=3001
   NODE_ENV=development

   Credenciales Azure AD:
   AZURE_CLIENT_ID=tu-client-id
   AZURE_TENANT_ID=tu-tenant-id

   Base de datos:
   DATABASE_URL=postgresql://usuario:contraseña@localhost:5432/tee_voting

   Seguridad:
   JWT_SECRET=generá-una-cadena-aleatoria-larga
   CORS_ORIGIN=http://localhost:3000

4. Iniciar servidor:
   npm run dev

El servidor estará disponible en http://localhost:3001

Scripts disponibles

npm run dev - Inicia con nodemon (recarga automática)
npm start - Inicia en modo producción
npm run build - Compila TypeScript a JavaScript
npm run test - Ejecuta pruebas automatizadas
npm run test:watch - Ejecuta pruebas en modo watch
npm run test:coverage - Ejecuta pruebas con reporte de cobertura
npm run test:dashboard:smoke - Ejecuta smoke test de dashboard (requiere API y DB)

Pruebas implementadas

Estrategia aplicada

- Caja negra (blackbox): validación de comportamiento HTTP en endpoints expuestos.
- Caja blanca (glassbox): validación de reglas de negocio en servicios con mocks de repositorios.
- Compilación y tipado: verificación estática con TypeScript usando `npm run typecheck`.
- Integración puntual: smoke test de dashboard contra API + base de datos real.

Suites automatizadas actuales

- API: `tests/api/health.e2e.test.ts` (endpoint `GET /api/health`).
- Unitarias Auth: `tests/unit/authService.test.ts`.
- Unitarias Dashboard: `tests/unit/dashboardService.test.ts`.
- Unitarias Elections: `tests/unit/electionService.test.ts`.
- Unitarias Voting: `tests/unit/votingService.test.ts`.

Resultado actual de la suite

- Comando: `npm test`.
- Estado: 5 archivos de prueba y 16 pruebas pasando.
- Cobertura: disponible con `npm run test:coverage` (reporte en consola y HTML).

Alcance cubierto por las pruebas

- Validaciones de dominio y padrón en autenticación.
- Restricciones de edición y transición de estados en elecciones.
- Reglas de publicación de elecciones (mínimo opciones y votantes elegibles).
- Flujo de voto nominal/anónimo y errores esperados de voto duplicado.
- Cálculo de resultados y participación.

Alcance no cubierto completamente (pendiente)

- Integración completa endpoint por endpoint con base de datos para todos los módulos.
- Pruebas de carga/performance y pruebas de seguridad especializadas.
- Cobertura exhaustiva de middlewares y todos los controladores.

Endpoints principales

POST /api/auth/microsoft
- Valida token de Microsoft y crea sesión
- Body: { idToken: string }
- Response: { token: string, user: { ... } }

GET /api/auth/profile
- Obtiene perfil del usuario autenticado
- Headers: Authorization: Bearer {token}

La documentación completa está en los archivos de rutas.

Troubleshooting

Error: "Student not found in the electoral registry"
- La base de datos no tiene datos de estudiantes cargados
- Verificar que la tabla de estudiantes tenga registros

Error 500 en /api/auth/microsoft
- Revisar que AZURE_CLIENT_ID y AZURE_TENANT_ID sean correctos
- Confirmar que JWT_SECRET esté configurado
- Ver los logs para el mensaje de error específico

Error de conexión a base de datos
- Verificar que PostgreSQL esté corriendo
- Confirmar que la DATABASE_URL sea correcta
- Revisar credenciales de acceso
