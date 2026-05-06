export const FRONTEND_URL =
  process.env.E2E_FRONTEND_URL ||
  process.env.PLAYWRIGHT_BASE_URL ||
  'http://localhost:3000';

export const BACKEND_URL =
  process.env.E2E_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:3001';

export function baseUrl(url: string): string {
  return url.replace(/\/$/, '');
}

export function apiUrl(path: string, backendUrl = BACKEND_URL): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl(backendUrl)}${normalizedPath}`;
}

export function frontendUrl(path = '/', frontendBaseUrl = FRONTEND_URL): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl(frontendBaseUrl)}${normalizedPath}`;
}

export function frontendOrigin(frontendBaseUrl = FRONTEND_URL): string {
  return new URL(baseUrl(frontendBaseUrl)).origin;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function frontendRootRegex(frontendBaseUrl = FRONTEND_URL): RegExp {
  return new RegExp(`${escapeRegExp(baseUrl(frontendBaseUrl))}/?$`);
}

export interface WaitForHttpOptions {
  timeoutMs?: number;
  intervalMs?: number;
  acceptStatus?: (status: number) => boolean;
}

export async function waitForHttp(
  url: string,
  {
    timeoutMs = 60_000,
    intervalMs = 1_000,
    acceptStatus = (status) => status >= 200 && status < 500,
  }: WaitForHttpOptions = {}
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (acceptStatus(response.status)) {
        return;
      }
      lastError = new Error(`Unexpected HTTP ${response.status} from ${url}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timed out waiting for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export async function waitForBackendHealth(backendUrl = BACKEND_URL): Promise<void> {
  await waitForHttp(apiUrl('/api/health', backendUrl), {
    acceptStatus: (status) => status >= 200 && status < 300,
  });
}

export async function waitForFrontendReady(frontendBaseUrl = FRONTEND_URL): Promise<void> {
  await waitForHttp(baseUrl(frontendBaseUrl));
}

