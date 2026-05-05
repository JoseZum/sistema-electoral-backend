import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import http from 'http';
import https from 'https';

const securityDir = dirname(fileURLToPath(import.meta.url));
const workDir = join(securityDir, '.zap');
const reportsDir = join(securityDir, 'reports');

const openApiSource = join(securityDir, 'openapi.json');
const openApiGenerated = join(workDir, 'openapi.generated.json');
const authOptionsFile = join(workDir, 'auth-header.prop');

const args = new Set(process.argv.slice(2));

if (args.has('--help') || args.has('-h')) {
  console.log(`
Uso:
  npm run test:security:zap

Variables:
  ZAP_TARGET_BASE_URL       URL base del backend vista desde Docker. Default: http://host.docker.internal:3001
  ZAP_AUTH_TOKEN            JWT opcional para escanear endpoints autenticados.
  ZAP_DOCKER_IMAGE          Imagen Docker de ZAP. Default: ghcr.io/zaproxy/zaproxy:stable
  ZAP_DOCKER_NETWORK        Red Docker opcional, por ejemplo proyecto_default.
  ZAP_FAIL_ON_WARNINGS      Si es "true", ZAP falla tambien con WARN.
  ZAP_SAFE_MODE             Si es "true", omite active scan y corre en modo seguro.
  ZAP_DEBUG                 Si es "true", muestra debug de ZAP.
  ZAP_INCLUDE_ALPHA         Si es "true", incluye reglas alpha.
  ZAP_MAX_WAIT_MINUTES      Espera maxima para arranque/pasivo de ZAP. Default: 5.
  ZAP_SKIP_HEALTHCHECK      Si es "true", no valida /api/health antes del scan.

Opciones:
  --dry-run                 Genera la OpenAPI runtime e imprime el comando Docker sin ejecutarlo.
`);
  process.exit(0);
}

const dockerImage = process.env.ZAP_DOCKER_IMAGE || 'ghcr.io/zaproxy/zaproxy:stable';
const targetBaseUrl = normalizeBaseUrl(
  process.env.ZAP_TARGET_BASE_URL || 'http://host.docker.internal:3001',
);
const dockerNetwork = trimToUndefined(process.env.ZAP_DOCKER_NETWORK);
const authToken = trimToUndefined(process.env.ZAP_AUTH_TOKEN);
const failOnWarnings = isTrue(process.env.ZAP_FAIL_ON_WARNINGS);
const safeMode = isTrue(process.env.ZAP_SAFE_MODE);
const debug = isTrue(process.env.ZAP_DEBUG);
const includeAlpha = isTrue(process.env.ZAP_INCLUDE_ALPHA);
const skipHealthcheck = isTrue(process.env.ZAP_SKIP_HEALTHCHECK);
const maxWaitMinutes = process.env.ZAP_MAX_WAIT_MINUTES || '5';

mkdirSync(workDir, { recursive: true });
mkdirSync(reportsDir, { recursive: true });

writeGeneratedOpenApi(targetBaseUrl);

if (authToken) {
  writeFileSync(
    authOptionsFile,
    [
      'replacer.full_list(0).description=AuthorizationBearer',
      'replacer.full_list(0).enabled=true',
      'replacer.full_list(0).matchtype=REQ_HEADER',
      'replacer.full_list(0).matchstr=Authorization',
      'replacer.full_list(0).regex=false',
      `replacer.full_list(0).replacement=Bearer ${authToken}`,
      '',
    ].join('\n'),
    'utf8',
  );
}

const dockerArgs = buildDockerArgs();

if (args.has('--dry-run')) {
  console.log('[security] ZAP dry-run. No se ejecuta Docker.');
  console.log(formatCommand('docker', dockerArgs));
  process.exit(0);
}

if (!skipHealthcheck && !dockerNetwork) {
  const healthy = await waitForHealth(targetBaseUrl, 15_000);
  if (!healthy) {
    console.error(
      `[security] Backend no disponible en ${healthUrlForHost(targetBaseUrl).toString()}. ` +
        'Levanta el backend antes de ejecutar ZAP o usa ZAP_SKIP_HEALTHCHECK=true.',
    );
    process.exit(1);
  }
}

console.log(`[security] Ejecutando OWASP ZAP API Scan contra ${targetBaseUrl}`);
if (!authToken) {
  console.log('[security] Sin ZAP_AUTH_TOKEN: los endpoints protegidos se validaran como no autenticados.');
}

const result = spawnSync('docker', dockerArgs, {
  cwd: securityDir,
  stdio: 'inherit',
  shell: false,
});

if (result.error) {
  if (result.error.code === 'ENOENT') {
    console.error('[security] Docker no esta instalado o no esta disponible en PATH.');
  } else {
    console.error(`[security] No se pudo ejecutar Docker: ${result.error.message}`);
  }
  process.exit(3);
}

if (result.status !== 0) {
  process.exit(result.status ?? 3);
}

console.log('[security] OWASP ZAP API Scan finalizado.');
console.log('[security] Reportes: tests/security/reports/zap-api-report.{html,json,md,xml}');

function writeGeneratedOpenApi(serverUrl) {
  const spec = JSON.parse(readFileSync(openApiSource, 'utf8'));
  spec.servers = [{ url: serverUrl }];
  writeFileSync(openApiGenerated, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
}

function buildDockerArgs() {
  const volume = `${securityDir}:/zap/wrk:rw`;
  const dockerRunArgs = ['run', '--rm', '-v', volume];

  if (dockerNetwork) {
    dockerRunArgs.push('--network', dockerNetwork);
  } else {
    dockerRunArgs.push('--add-host', 'host.docker.internal:host-gateway');
  }

  const zapArgs = [
    dockerImage,
    'zap-api-scan.py',
    '-t',
    '/zap/wrk/.zap/openapi.generated.json',
    '-f',
    'openapi',
    '-c',
    '/zap/wrk/zap-api-rules.conf',
    '-r',
    '/zap/wrk/reports/zap-api-report.html',
    '-J',
    '/zap/wrk/reports/zap-api-report.json',
    '-w',
    '/zap/wrk/reports/zap-api-report.md',
    '-x',
    '/zap/wrk/reports/zap-api-report.xml',
    '-T',
    maxWaitMinutes,
  ];

  if (!failOnWarnings) {
    zapArgs.push('-I');
  }
  if (safeMode) {
    zapArgs.push('-S');
  }
  if (debug) {
    zapArgs.push('-d');
  }
  if (includeAlpha) {
    zapArgs.push('-a');
  }
  if (authToken) {
    zapArgs.push('-z', '-configfile /zap/wrk/.zap/auth-header.prop');
  }

  return [...dockerRunArgs, ...zapArgs];
}

function normalizeBaseUrl(value) {
  const parsed = new URL(value);
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function trimToUndefined(value) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isTrue(value) {
  return typeof value === 'string' && ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function healthUrlForHost(baseUrl) {
  const url = new URL('/api/health', baseUrl);
  if (url.hostname === 'host.docker.internal') {
    url.hostname = '127.0.0.1';
  }
  return url;
}

async function waitForHealth(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const url = healthUrlForHost(baseUrl);

  while (Date.now() < deadline) {
    if (await httpOk(url)) {
      return true;
    }
    await delay(750);
  }

  return false;
}

function httpOk(url) {
  const client = url.protocol === 'https:' ? https : http;

  return new Promise((resolve) => {
    const request = client.get(url, { timeout: 3000 }, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });

    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });
    request.on('error', () => resolve(false));
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatCommand(command, commandArgs) {
  return [command, ...commandArgs].map(quoteArg).join(' ');
}

function quoteArg(arg) {
  if (/^[A-Za-z0-9_./:=@-]+$/.test(arg)) {
    return arg;
  }
  return `"${arg.replace(/"/g, '\\"')}"`;
}
