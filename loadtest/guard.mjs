/**
 * Guarda de seguridad compartida por seed.mjs, verify.mjs y cleanup.mjs.
 *
 * Estos scripts SIEMBRAN Y BORRAN miles de filas. Apuntarlos a produccion contaminaria el
 * padron real de un sistema electoral, asi que el destino se valida antes de abrir el pool.
 *
 * Reglas, en orden:
 *   1. El ref del proyecto de PRODUCCION esta en lista negra. Siempre aborta, sin excepcion:
 *      ninguna variable de entorno puede habilitarlo.
 *   2. Postgres local (localhost / 127.0.0.1 / host 'postgres' de docker-compose): permitido.
 *   3. Cualquier otro destino remoto: permitido SOLO si LOADTEST_ALLOW_REMOTE trae exactamente
 *      el ref de ese proyecto. Es un opt-in explicito y especifico — no un interruptor global —
 *      para que apuntar a un Supabase nuevo sea siempre un acto deliberado.
 */

/**
 * Proyectos que jamas deben recibir datos de prueba. Se leen del entorno y NO se escriben
 * aqui: este repositorio es publico y el ref identifica al proyecto real de Supabase.
 *
 * Configurar en loadtest/.env.loadtest (ignorado por git):
 *   LOADTEST_PROD_REFS=<ref-de-produccion>[,<otro-ref>]
 *
 * Si la lista queda vacia la proteccion no desaparece: la regla 3 sigue exigiendo que
 * cualquier destino remoto se autorice con su ref exacto, asi que apuntar a produccion nunca
 * puede pasar por descuido — tendria que escribirse su ref a mano y a proposito.
 */
const PROD_PROJECT_REFS = (process.env.LOADTEST_PROD_REFS || '')
  .split(',')
  .map((ref) => ref.trim())
  .filter(Boolean);

function redact(databaseUrl) {
  return databaseUrl.replace(/:[^:@/]+@/, ':***@');
}

/**
 * Parsea la URL en vez de aplicar regex sobre la cadena completa. Importa: casi todas las URLs
 * de Supabase usan el USUARIO 'postgres', y un regex ingenuo de host lo confunde con el host
 * 'postgres' de docker-compose y da un remoto por local.
 */
function parseDatabaseUrl(databaseUrl) {
  try {
    const url = new URL(databaseUrl);
    return { host: url.hostname.toLowerCase(), user: decodeURIComponent(url.username) };
  } catch {
    return null;
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'postgres']);

/** Extrae el ref del proyecto de una URL de Supabase (directa o via pooler). */
function supabaseProjectRef({ host, user }) {
  const direct = host.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
  if (direct) return direct[1];

  // El pooler lleva el ref en el usuario: postgres.<ref>@...pooler.supabase.com
  if (/pooler\.supabase\.com$/i.test(host)) {
    const pooled = user.match(/^postgres\.([a-z0-9]+)$/i);
    if (pooled) return pooled[1];
  }

  return null;
}

function abort(message) {
  console.error(`\n[ABORTADO] ${message}\n`);
  process.exit(1);
}

/**
 * Aborta el proceso si `databaseUrl` no es un destino seguro para datos de prueba.
 * Devuelve una etiqueta del destino aceptado, util para registrarla en consola.
 */
export function assertSafeTarget(databaseUrl) {
  if (!databaseUrl) {
    abort('Falta DATABASE_URL.');
  }

  const parts = parseDatabaseUrl(databaseUrl);
  if (!parts) {
    abort(`DATABASE_URL no es una URL valida: ${redact(databaseUrl)}`);
  }

  const ref = supabaseProjectRef(parts);

  if (ref && PROD_PROJECT_REFS.includes(ref)) {
    abort(
      `DATABASE_URL apunta al proyecto de PRODUCCION (${ref}).\n` +
        'Las pruebas de carga jamas deben sembrar ni borrar ahi.\n' +
        `URL: ${redact(databaseUrl)}`
    );
  }

  if (LOCAL_HOSTS.has(parts.host)) {
    return 'Postgres local';
  }

  const allowed = (process.env.LOADTEST_ALLOW_REMOTE || '').trim();
  if (!ref) {
    abort(
      'DATABASE_URL no es local y no se reconoce como un proyecto de Supabase.\n' +
        `URL: ${redact(databaseUrl)}`
    );
  }

  if (allowed !== ref) {
    abort(
      `DATABASE_URL apunta al proyecto remoto ${ref}, que no esta autorizado.\n` +
        `Para permitirlo de forma deliberada: LOADTEST_ALLOW_REMOTE=${ref}\n` +
        `URL: ${redact(databaseUrl)}`
    );
  }

  return `Supabase remoto ${ref} (autorizado explicitamente)`;
}
