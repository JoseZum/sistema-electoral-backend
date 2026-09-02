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
| `capacity.js` | Punto de quiebre: sube la tasa por escalones y clasifica los fallos por causa | ninguno — el objetivo es *llegar* al fallo y verlo |
| `conn-ceiling.mjs` | Cuántas conexiones simultáneas concede el servidor | el número, y si el rechazo es limpio o un cuelgue |
| `monitor.mjs` | Qué pasa *dentro* de Postgres durante la corrida (CSV) | conexiones activas, esperas de lock, CPU del host |
| `verify.mjs` | Integridad en la BD (fuente de verdad) | sin doble voto, conteos cuadran, secreto del voto |

> **Por qué `capacity.js` y no solo `vote-load.js`:** `vote-load.js` usa VUs fijos, así que cuando
> el sistema se pone lento la propia carga se frena y el límite real queda escondido.
> `capacity.js` usa `ramping-arrival-rate`, que sostiene la tasa objetivo aunque suba la latencia.

## Guarda de seguridad (`guard.mjs`)
`seed.mjs`, `verify.mjs`, `cleanup.mjs` y `monitor.mjs` validan el destino antes de abrir el pool:

1. Los refs de `LOADTEST_PROD_REFS` se bloquean **siempre**, sin excepción posible.
2. Postgres local: permitido.
3. Cualquier otro destino remoto: permitido **solo** si `LOADTEST_ALLOW_REMOTE` trae su ref exacto.

Configura en `.env.loadtest` (ignorado por git, porque este repositorio es público):
```
LOADTEST_PROD_REFS=<ref-del-proyecto-de-produccion>
```

## Medir contra un Supabase de staging
Para reproducir el comportamiento serverless de Vercel — cada instancia con **su propia**
conexión — sin tocar producción:

```powershell
# 1. Credenciales del staging en loadtest/.env.staging (ignorado por git)
#    STAGING_DATABASE_URL=postgresql://postgres.<ref>:<pwd>@aws-0-us-east-1.pooler.supabase.com:5432/postgres
#    STAGING_DATABASE_URL_TX=...:6543/postgres      # transaction mode
#    LOADTEST_ALLOW_REMOTE=<ref-de-staging>

# 2. Techo de conexiones (el dato que de verdad limita a un backend serverless)
node loadtest/conn-ceiling.mjs --url "$URL" --max 250 --label session

# 3. N lambdas simuladas, cada una con DATABASE_POOL_MAX=1
npm run build
docker compose -f loadtest/docker-compose.serverless-sim.yml `
  --env-file loadtest/.env.staging up -d --scale backend-load=30

# 4. Carga + monitor en paralelo (meta.json debe apuntar a http://localhost:8090)
node loadtest/seed-tokens.mjs
node loadtest/monitor.mjs --out loadtest/resultados/monitor.csv --label tx-30rep
k6 run loadtest/capacity.js -e PEAK=120 -e STAGE=20s
```

> ⚠️ **No apuntes k6 a un despliegue de Vercel.** Vercel solo permite pruebas de carga en plan
> Enterprise y con aviso previo; hacerlo sin autorización puede provocar el bloqueo de las IP de
> origen. Mide contra la base de datos, que es donde está el límite real.
>
> ℹ️ Los hosts directos (`db.<ref>.supabase.co`) resuelven **solo a IPv6**. Desde una red sin IPv6
> hay que usar el pooler.

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
