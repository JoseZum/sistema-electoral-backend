import jwt from 'jsonwebtoken';
import jwksRsa from 'jwks-rsa';
import { env } from '../../../config/env';
import { MicrosoftIdTokenClaims } from '../models/authModel';

// Multi-tenant: usar el endpoint JWKS común de Microsoft
const jwksClient = jwksRsa({
  jwksUri: 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
  cache: true,
  rateLimit: true,
  jwksRequestsPerMinute: 10,
});

function getSigningKey(header: jwt.JwtHeader): Promise<string> {
  return new Promise((resolve, reject) => {
    jwksClient.getSigningKey(header.kid, (err, key) => {
      if (err) return reject(err);
      if (!key) return reject(new Error('No se encontró la clave de firma'));
      const signingKey = key.getPublicKey();
      resolve(signingKey);
    });
  });
}

export async function verifyMicrosoftIdToken(idToken: string): Promise<MicrosoftIdTokenClaims> {
  const decodedHeader = jwt.decode(idToken, { complete: true });
  if (!decodedHeader || !decodedHeader.header) {
    throw new Error('Token inválido: no se pudo decodificar el header');
  }

  const signingKey = await getSigningKey(decodedHeader.header);

  // Multi-tenant: omitir validación del issuer aquí, solo verificar audience + firma.
  // La restricción de dominio (@estudiantec.cr) se aplica en authService.
  const payload = jwt.verify(idToken, signingKey, {
    audience: env.azure.clientId,
    algorithms: ['RS256'],
  }) as MicrosoftIdTokenClaims;

  // Verificación de seguridad: el issuer debe ser de Microsoft
  const iss = payload.iss || '';
  if (!iss.includes('login.microsoftonline.com') && !iss.includes('sts.windows.net')) {
    throw new Error('Emisor del token inválido');
  }

  return payload;
}
