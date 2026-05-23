Backend - Sistema Electoral TEE

API REST para gestion de votaciones y autenticacion con Microsoft Azure AD.

Stack:
- Node.js 18+
- Express.js
- PostgreSQL / Supabase Postgres
- JWT para sesiones
- Azure AD para autenticacion OAuth

## Modo local

El flujo local no cambia:

1. Desde la raiz del monorepo ejecuta `docker compose up -d`
2. El backend queda disponible en `http://localhost:3001`
3. La base local se inicializa con los scripts de `supabase/schema/`

Si queres correr solo el backend fuera de Docker:

1. `npm install`
2. Crea `.env` a partir de `.env.example`
3. Ejecuta `npm run dev`

## Modo Vercel serverless

La aplicacion Express sigue separada del arranque local:

- `src/index.ts` configura y exporta la app
- `src/server.ts` hace `listen()` para desarrollo local
- `src/api/index.ts` reexporta la app para Vercel serverless

Variables requeridas en Vercel:

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `JWT_SECRET`
- `VOTE_TOKEN_SECRET`
- `DATABASE_URL`
- `CORS_ORIGIN`
- `DATABASE_POOL_MAX=1`

Base de datos en Vercel:

- Usa la `DATABASE_URL` del Transaction pooler de Supabase para trafico serverless
- El backend detecta URLs de Supabase, activa SSL automaticamente y elimina `sslmode` de la URL para que `pg` aplique la configuracion TLS del pool

## Variables locales

Ejemplo minimo para local:

```env
PORT=3001
NODE_ENV=development
AZURE_CLIENT_ID=<azure-app-client-id>
AZURE_TENANT_ID=<azure-tenant-id>
JWT_SECRET=<random-secret-for-session-jwt>
VOTE_TOKEN_SECRET=<random-secret-for-vote-token-hashing-and-encryption>
DATABASE_URL=postgresql://tee_admin:tee_local_password@localhost:5432/tee_voting
DATABASE_SSL=false
DATABASE_SSL_REJECT_UNAUTHORIZED=false
DATABASE_POOL_MAX=10
CORS_ORIGIN=http://localhost:3000
```

## Scripts disponibles

- `npm run dev` - Inicia con nodemon
- `npm start` - Inicia la version compilada
- `npm run build` - Compila TypeScript
- `npm run typecheck` - Valida tipos sin emitir archivos

## Endpoints principales

`POST /api/auth/microsoft`
- Valida token de Microsoft y crea sesion
- Body: `{ idToken: string }`
- Response: `{ token: string, user: { ... } }`

`GET /api/auth/profile`
- Obtiene perfil del usuario autenticado
- Headers: `Authorization: Bearer {token}`

La documentacion detallada sigue en los modulos y rutas del proyecto.

## Troubleshooting

Error: `Student not found in the electoral registry`
- La base de datos no tiene datos de estudiantes cargados
- Verifica que la tabla de estudiantes tenga registros

Error 500 en `/api/auth/microsoft`
- Revisa `AZURE_CLIENT_ID` y `AZURE_TENANT_ID`
- Confirma `JWT_SECRET`
- Revisa los logs del backend

Error de conexion a base de datos
- Verifica que PostgreSQL o Supabase esten accesibles
- Confirma que `DATABASE_URL` sea correcta
- En Vercel, usa el pooler transaccional de Supabase
