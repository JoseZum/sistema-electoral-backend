import jwt from 'jsonwebtoken';
import jwksRsa from 'jwks-rsa';
import { env } from '../config/env';
import { MicrosoftIdTokenClaims } from './authModel';

// Multi-tenant: use the common JWKS endpoint
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
      if (!key) return reject(new Error('No signing key found'));
      const signingKey = key.getPublicKey();
      resolve(signingKey);
    });
  });
}

export async function verifyMicrosoftIdToken(idToken: string): Promise<MicrosoftIdTokenClaims> {
  const decodedHeader = jwt.decode(idToken, { complete: true });
  if (!decodedHeader || !decodedHeader.header) {
    throw new Error('Invalid token: unable to decode header');
  }

  const signingKey = await getSigningKey(decodedHeader.header);

  // Multi-tenant: skip issuer validation here, verify audience + signature only.
  // Domain restriction (@estudiantec.cr) is enforced in authService.
  const payload = jwt.verify(idToken, signingKey, {
    audience: env.azure.clientId,
    algorithms: ['RS256'],
  }) as MicrosoftIdTokenClaims;

  // Sanity check: issuer must be from Microsoft
  const iss = payload.iss || '';
  if (!iss.includes('login.microsoftonline.com') && !iss.includes('sts.windows.net')) {
    throw new Error('Invalid token issuer');
  }

  return payload;
}
