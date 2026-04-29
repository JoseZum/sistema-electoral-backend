import https from 'https';
import jwt from 'jsonwebtoken';
import jwksRsa from 'jwks-rsa';
import { env } from '../../../config/env';
import { AppError } from '../../../errors/appError';
import { MicrosoftIdTokenClaims } from '../models/authModel';

const microsoftJwksAgent = new https.Agent({
  family: 4,
});

const jwksClient = jwksRsa({
  jwksUri: 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
  cache: true,
  rateLimit: true,
  jwksRequestsPerMinute: 10,
  requestAgent: microsoftJwksAgent,
});

function describeJwksError(error: unknown): string {
  if (error instanceof AggregateError) {
    const aggregateDetails = error.errors
      .map((nestedError) => {
        if (nestedError instanceof Error) {
          const nestedCode =
            'code' in nestedError && typeof (nestedError as { code?: unknown }).code === 'string'
              ? (nestedError as { code: string }).code
              : undefined;

          return [nestedCode, nestedError.message].filter(Boolean).join(': ');
        }

        return String(nestedError);
      })
      .filter(Boolean)
      .join(' | ');

    if (aggregateDetails) {
      return aggregateDetails;
    }
  }

  if (error instanceof Error) {
    const errorCode =
      'code' in error && typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : undefined;

    return [errorCode, error.message || error.name].filter(Boolean).join(': ');
  }

  return String(error);
}

async function getSigningKey(header: jwt.JwtHeader): Promise<string> {
  if (!header.kid) {
    throw new AppError({
      status: 401,
      code: 'AUTH_TOKEN_INVALID',
      message: 'Autenticacion fallida: token de Microsoft invalido.',
      details: 'Missing kid in token header',
    });
  }

  try {
    const key = await jwksClient.getSigningKey(header.kid);
    return key.getPublicKey();
  } catch (error) {
    const errorName = error instanceof Error ? error.name : '';
    const errorMessage = describeJwksError(error);

    if (errorName === 'SigningKeyNotFoundError') {
      throw new AppError({
        status: 401,
        code: 'AUTH_SIGNING_KEY_NOT_FOUND',
        message: 'Autenticacion fallida: no se encontro una clave publica compatible para validar el token de Microsoft.',
        details: errorMessage,
        cause: error,
      });
    }

    if (errorName === 'JwksRateLimitError') {
      throw new AppError({
        status: 503,
        code: 'AUTH_JWKS_RATE_LIMITED',
        message: 'El servicio de validacion con Microsoft esta temporalmente saturado. Intenta nuevamente en unos minutos.',
        details: errorMessage,
        cause: error,
      });
    }

    throw new AppError({
      status: 503,
      code: 'AUTH_JWKS_UNAVAILABLE',
      message: 'No fue posible validar la autenticacion con Microsoft. Intenta nuevamente.',
      details: errorMessage,
      cause: error,
    });
  }
}

export async function verifyMicrosoftIdToken(idToken: string): Promise<MicrosoftIdTokenClaims> {
  if (!env.azure.clientId) {
    throw new AppError({
      status: 500,
      code: 'AUTH_CONFIG_ERROR',
      message: 'La configuracion de autenticacion no esta completa.',
      details: 'AZURE_CLIENT_ID is missing',
    });
  }

  const decodedHeader = jwt.decode(idToken, { complete: true });
  if (!decodedHeader || !decodedHeader.header) {
    throw new AppError({
      status: 401,
      code: 'AUTH_TOKEN_INVALID',
      message: 'Autenticacion fallida: token de Microsoft invalido.',
      details: 'No se pudo decodificar el header del token',
    });
  }

  const signingKey = await getSigningKey(decodedHeader.header);

  let payload: MicrosoftIdTokenClaims;
  try {
    payload = jwt.verify(idToken, signingKey, {
      audience: env.azure.clientId,
      algorithms: ['RS256'],
    }) as MicrosoftIdTokenClaims;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new AppError({
        status: 401,
        code: 'AUTH_MICROSOFT_TOKEN_EXPIRED',
        message: 'La sesion con Microsoft expiro. Inicia sesion nuevamente.',
        details: error.message,
        cause: error,
      });
    }

    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.NotBeforeError) {
      throw new AppError({
        status: 401,
        code: 'AUTH_TOKEN_INVALID',
        message: 'Autenticacion fallida: token de Microsoft invalido.',
        details: error.message,
        cause: error,
      });
    }

    throw new AppError({
      status: 503,
      code: 'AUTH_PROVIDER_UNAVAILABLE',
      message: 'No fue posible validar la autenticacion con Microsoft. Intenta nuevamente.',
      details: error instanceof Error ? error.message : String(error),
      cause: error,
    });
  }

  const issuer = payload.iss || '';
  if (!issuer.includes('login.microsoftonline.com') && !issuer.includes('sts.windows.net')) {
    throw new AppError({
      status: 401,
      code: 'AUTH_TOKEN_INVALID',
      message: 'Autenticacion fallida: emisor del token invalido.',
      details: issuer,
    });
  }

  return payload;
}
