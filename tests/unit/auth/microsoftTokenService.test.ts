import { generateKeyPairSync } from 'crypto';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { env } from '../../../src/config/env';
import { verifyMicrosoftIdToken } from '../../../src/modules/auth/services/microsoftTokenService';

const jwksMocks = vi.hoisted(() => {
  const getSigningKey = vi.fn();
  const jwksRsa = vi.fn(() => ({ getSigningKey }));

  return { getSigningKey, jwksRsa };
});

vi.mock('jwks-rsa', () => ({
  default: jwksMocks.jwksRsa,
}));

describe('microsoftTokenService', () => {
  const originalClientId = env.azure.clientId;
  const clientId = 'azure-client-id-for-tests';
  const keyId = 'test-key-id';
  const validIssuer = 'https://login.microsoftonline.com/tenant-id/v2.0';

  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
  });

  function signMicrosoftToken(
    overrides: Partial<jwt.SignOptions> = {},
    payloadOverrides: Record<string, unknown> = {},
  ): string {
    return jwt.sign(
      {
        email: 'student@estudiantec.cr',
        preferred_username: 'student@estudiantec.cr',
        name: 'Jane Student',
        oid: 'microsoft-object-id',
        tid: 'tenant-id',
        ...payloadOverrides,
      },
      privateKey,
      {
        algorithm: 'RS256',
        audience: clientId,
        expiresIn: '1h',
        issuer: validIssuer,
        keyid: keyId,
        subject: 'microsoft-subject-id',
        ...overrides,
      },
    );
  }

  beforeEach(() => {
    env.azure.clientId = clientId;
    jwksMocks.getSigningKey.mockReset();
    jwksMocks.getSigningKey.mockResolvedValue({
      getPublicKey: () => publicKey,
    });
  });

  afterEach(() => {
    env.azure.clientId = originalClientId;
  });

  it('verifies a valid Microsoft ID token and returns its claims', async () => {
    const token = signMicrosoftToken();

    const result = await verifyMicrosoftIdToken(token);

    expect(jwksMocks.getSigningKey).toHaveBeenCalledWith(keyId);
    expect(result).toMatchObject({
      aud: clientId,
      email: 'student@estudiantec.cr',
      iss: validIssuer,
      name: 'Jane Student',
      oid: 'microsoft-object-id',
      preferred_username: 'student@estudiantec.cr',
      sub: 'microsoft-subject-id',
      tid: 'tenant-id',
    });
  });

  it('fails when Azure client id is not configured', async () => {
    env.azure.clientId = '';

    await expect(verifyMicrosoftIdToken('irrelevant-token')).rejects.toMatchObject({
      status: 500,
      code: 'AUTH_CONFIG_ERROR',
      details: 'AZURE_CLIENT_ID is missing',
    });

    expect(jwksMocks.getSigningKey).not.toHaveBeenCalled();
  });

  it('fails when the token header cannot be decoded', async () => {
    await expect(verifyMicrosoftIdToken('not-a-jwt')).rejects.toMatchObject({
      status: 401,
      code: 'AUTH_TOKEN_INVALID',
      details: 'No se pudo decodificar el header del token',
    });

    expect(jwksMocks.getSigningKey).not.toHaveBeenCalled();
  });

  it('fails when the token header does not include a key id', async () => {
    const tokenWithoutKeyId = jwt.sign({ email: 'student@estudiantec.cr' }, 'shared-secret');

    await expect(verifyMicrosoftIdToken(tokenWithoutKeyId)).rejects.toMatchObject({
      status: 401,
      code: 'AUTH_TOKEN_INVALID',
      details: 'Missing kid in token header',
    });

    expect(jwksMocks.getSigningKey).not.toHaveBeenCalled();
  });

  it('maps a missing Microsoft signing key to a 401 AppError', async () => {
    const error = new Error('key not found');
    error.name = 'SigningKeyNotFoundError';
    jwksMocks.getSigningKey.mockRejectedValue(error);

    await expect(verifyMicrosoftIdToken(signMicrosoftToken())).rejects.toMatchObject({
      status: 401,
      code: 'AUTH_SIGNING_KEY_NOT_FOUND',
      details: 'key not found',
    });
  });

  it('maps Microsoft JWKS rate limiting to a 503 AppError', async () => {
    const error = new Error('too many requests');
    error.name = 'JwksRateLimitError';
    jwksMocks.getSigningKey.mockRejectedValue(error);

    await expect(verifyMicrosoftIdToken(signMicrosoftToken())).rejects.toMatchObject({
      status: 503,
      code: 'AUTH_JWKS_RATE_LIMITED',
      details: 'too many requests',
    });
  });

  it('maps generic JWKS failures to a 503 AppError', async () => {
    const error = Object.assign(new Error('network unavailable'), { code: 'ENOTFOUND' });
    jwksMocks.getSigningKey.mockRejectedValue(error);

    await expect(verifyMicrosoftIdToken(signMicrosoftToken())).rejects.toMatchObject({
      status: 503,
      code: 'AUTH_JWKS_UNAVAILABLE',
      details: 'ENOTFOUND: network unavailable',
    });
  });

  it('rejects expired Microsoft tokens', async () => {
    const expiredToken = signMicrosoftToken({ expiresIn: '-1s' });

    await expect(verifyMicrosoftIdToken(expiredToken)).rejects.toMatchObject({
      status: 401,
      code: 'AUTH_MICROSOFT_TOKEN_EXPIRED',
    });
  });

  it('rejects tokens with an invalid audience', async () => {
    const wrongAudienceToken = signMicrosoftToken({ audience: 'another-client-id' });

    await expect(verifyMicrosoftIdToken(wrongAudienceToken)).rejects.toMatchObject({
      status: 401,
      code: 'AUTH_TOKEN_INVALID',
    });
  });

  it('rejects tokens with a non-Microsoft issuer', async () => {
    const wrongIssuerToken = signMicrosoftToken({
      issuer: 'https://malicious.example.com',
    });

    await expect(verifyMicrosoftIdToken(wrongIssuerToken)).rejects.toMatchObject({
      status: 401,
      code: 'AUTH_TOKEN_INVALID',
      details: 'https://malicious.example.com',
    });
  });
});
