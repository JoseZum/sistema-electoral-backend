import jwt from 'jsonwebtoken';
import jwksRsa from 'jwks-rsa';
import { env } from '../../../config/env';
import { AppError } from '../../../errors/appError';
import { MicrosoftIdTokenClaims } from '../models/authModel';

const jwksClient = jwksRsa({
  jwksUri: 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
  cache: true,
  rateLimit: true,
  jwksRequestsPerMinute: 10,
});

function getSigningKey(header: jwt.JwtHeader): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!header.kid) {
      reject(
        new AppError({
          status: 401,
          code: 'AUTH_TOKEN_INVALID',
          message: 'Autenticacion fallida: token de Microsoft invalido.',
          details: 'Missing kid in token header',
        })
      );
      return;
    }

    jwksClient.getSigningKey(header.kid, (err, key) => {
      if (err) {
        reject(
          new AppError({
            status: 503,
            code: 'AUTH_JWKS_UNAVAILABLE',
            message: 'No fue posible validar la autenticacion con Microsoft. Intenta nuevamente.',
            details: err.message,
            cause: err,
          })
        );
        return;
      }

      if (!key) {
        reject(
          new AppError({
            status: 401,
            code: 'AUTH_TOKEN_INVALID',
            message: 'Autenticacion fallida: no se encontro la clave de firma del token.',
          })
        );
        return;
      }

      resolve(key.getPublicKey());
    });
  });
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
