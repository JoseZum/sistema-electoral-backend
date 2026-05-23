import dotenv from 'dotenv';

dotenv.config();

const defaultDatabaseUrl = 'postgresql://tee_admin:tee_local_password@localhost:5432/tee_voting';
const runningOnVercel = Boolean(process.env.VERCEL);
const rawDatabaseUrl = process.env.DATABASE_URL || (runningOnVercel ? '' : defaultDatabaseUrl);

if (!rawDatabaseUrl) {
  throw new Error('DATABASE_URL is required for Vercel deployments.');
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalizedValue = value.trim().toLowerCase();

  if (['1', 'true', 'yes', 'on'].includes(normalizedValue)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalizedValue)) {
    return false;
  }

  return undefined;
}

function normalizeDatabaseUrl(databaseUrl: string): string {
  const [baseUrl, queryString] = databaseUrl.split('?', 2);

  if (!queryString) {
    return databaseUrl;
  }

  const params = new URLSearchParams(queryString);
  params.delete('sslmode');

  const normalizedQueryString = params.toString();
  return normalizedQueryString ? `${baseUrl}?${normalizedQueryString}` : baseUrl;
}

const isSupabaseConnection = /supabase\.co|pooler\.supabase\.com/i.test(rawDatabaseUrl);
const databaseSsl = parseBoolean(process.env.DATABASE_SSL) ?? isSupabaseConnection;
const databaseSslRejectUnauthorized =
  parseBoolean(process.env.DATABASE_SSL_REJECT_UNAUTHORIZED) ?? false;
const defaultPoolMax = runningOnVercel ? '1' : '10';
const parsedDatabasePoolMax = parseInt(process.env.DATABASE_POOL_MAX || defaultPoolMax, 10);

export const env = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  azure: {
    clientId: process.env.AZURE_CLIENT_ID || '',
    tenantId: process.env.AZURE_TENANT_ID || '',
  },
  jwtSecret: process.env.JWT_SECRET || '',
  voteTokenSecret: process.env.VOTE_TOKEN_SECRET || process.env.JWT_SECRET,
  databaseUrl: normalizeDatabaseUrl(rawDatabaseUrl),
  databaseSsl,
  databaseSslRejectUnauthorized,
  databasePoolMax: Number.isNaN(parsedDatabasePoolMax) ? 10 : parsedDatabasePoolMax,
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
};
