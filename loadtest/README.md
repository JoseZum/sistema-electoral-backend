# Pruebas de carga de votación con k6

Verifican que el sistema aguanta una votación real **sin errores y sin doble voto**, bajo
concurrencia alta. Corren contra un **Postgres local aislado** — nunca contra producción.

> 🔒 **Seguridad:** `seed.mjs`, `verify.mjs` y `cleanup.mjs` **abortan si `DATABASE_URL` no es
> local** (bloquean Supabase). Aun así, arranca el backend con las variables de abajo para que
> apunte a la BD local y no a tu `.env` (que apunta a Supabase).

## Prerrequisitos (una vez)
- **Docker Desktop** abierto (para el Postgres local).
- **k6** instalado: `winget install k6 --source winget` (o `choco install k6`).

## Escenarios
| Script | Qué prueba | Umbral clave |
|---|---|---|
| `vote-load.js` | Votación realista: cada votante emite 1 voto | 0 errores, 0 rate-limit a votantes legítimos, p95 < 1.5 s |
| `double-vote.js` | Ataque de doble voto: muchas peticiones con el MISMO token | **exactamente 1 voto aceptado**, 0 errores |
| `verify.mjs` | Integridad en la BD (fuente de verdad) | sin doble voto, conteos cuadran, secreto del voto |

---

## Pasos (PowerShell)

### 1. Levantar el Postgres local (desde la raíz del repo)
```powershell
docker compose up -d postgres
# espera a que quede "healthy" (docker ps)
```
Esto crea el esquema, stored procedures, triggers y seed automáticamente.

### 2. Arrancar el backend apuntando a la BD LOCAL (ventana aparte, en sistema-electoral-backend)
```powershell
$env:DATABASE_URL   = "postgresql://tee_admin:tee_local_password@localhost:5432/tee_voting"
$env:JWT_SECRET     = "loadtest_only_secret_not_for_prod"
$env:VOTE_TOKEN_SECRET = "loadtest_only_vote_secret_not_for_prod"
$env:NODE_ENV       = "production"
# Opcional: simular el limite de 1 conexion de Vercel serverless
# $env:DATABASE_POOL_MAX = "1"
npm run dev
```
> `dotenv` no sobreescribe variables ya definidas, así que estos `$env:` **ganan** sobre el `.env`
> (que apunta a Supabase). Los valores de `JWT_SECRET`/`VOTE_TOKEN_SECRET` deben coincidir con
> `loadtest/.env.loadtest`.

### 3. Sembrar votantes + elección (en sistema-electoral-backend)
```powershell
node loadtest/seed.mjs        # usa loadtest/.env.loadtest ; VOTERS=1000 por defecto
```

### 4. Correr k6
```powershell
# Votación realista (sube la concurrencia con -e VUS=100)
k6 run loadtest/vote-load.js -e VUS=100

# Integridad ante doble voto (re-siembra antes para tener un votante sin usar)
node loadtest/cleanup.mjs; node loadtest/seed.mjs
k6 run loadtest/double-vote.js -e VUS=50 -e ITER=4
```

### 5. Verificar integridad en la BD (autoritativo)
```powershell
node loadtest/verify.mjs
```

### 6. Limpiar
```powershell
node loadtest/cleanup.mjs
# o para borrar todo el Postgres local:  docker compose down -v
```

---

## Cómo leer los resultados
- **`vote-load.js`**: `votes_ok` debe ≈ nº de votantes; `votes_error` y `votes_ratelimited` en **0**.
  Si aparecen 429, el rate limiter está bloqueando a votantes legítimos (bloqueante **C5**).
  Si sube la latencia p95/p99 al poner `DATABASE_POOL_MAX=1`, es el riesgo de agotamiento de
  conexiones en serverless (revisar pooler de Supabase).
- **`double-vote.js`**: `votes_ok` debe ser **exactamente 1**. Cualquier otro valor sería doble
  voto (fallo crítico de integridad). El resto: 409.
- **`verify.mjs`**: todos los chequeos en `PASS`. Es la prueba definitiva porque consulta la BD.

## Notas
- Elección anónima: pon `ELECTION_MODE=anonymous` en `.env.loadtest` y vuelve a sembrar. `verify.mjs`
  añadirá el chequeo de **secreto del voto** (ningún voto guarda `student_id`).
- No cubre el login real de Microsoft (k6 no hace OAuth): los JWT de sesión se generan directamente,
  lo cual ejercita todo el stack de voto (middleware, servicio, stored procedures, pool) que es lo
  que importa para la carga.
