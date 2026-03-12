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
