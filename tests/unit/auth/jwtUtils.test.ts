import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { env } from '../../../src/config/env';
import { SessionJWTPayload } from '../../../src/modules/auth/models/authModel';
import { createSessionJWT, verifySessionJWT } from '../../../src/modules/auth/services/jwtUtils';

describe('jwtUtils', () => {
  const originalJwtSecret = env.jwtSecret;
  const testSecret = 'unit-test-session-secret';

  const payload: SessionJWTPayload = {
    studentId: 'student-123',
    carnet: '2020123456',
    email: 'student@estudiantec.cr',
    fullName: 'Jane Student',
    role: 'admin',
  };

  beforeEach(() => {
    env.jwtSecret = testSecret;
  });

  afterEach(() => {
    env.jwtSecret = originalJwtSecret;
  });

  describe('createSessionJWT', () => {
    it('creates a token signed with the configured secret and expected claims', () => {
      const issuedAtLowerBound = Math.floor(Date.now() / 1000);

      const token = createSessionJWT(payload);

      expect(token).toEqual(expect.any(String));

      const decoded = jwt.verify(token, testSecret, {
        issuer: 'tee-voting-system',
      }) as jwt.JwtPayload;

      expect(decoded).toMatchObject(payload);
      expect(decoded.iss).toBe('tee-voting-system');
      expect(decoded.iat).toBeGreaterThanOrEqual(issuedAtLowerBound);
      expect(decoded.exp).toBe(decoded.iat! + 8 * 60 * 60);
    });
  });

  describe('verifySessionJWT', () => {
    it('returns the session payload for a valid system token', () => {
      const token = jwt.sign(payload, testSecret, {
        expiresIn: '8h',
        issuer: 'tee-voting-system',
      });

      const result = verifySessionJWT(token);

      expect(result).toMatchObject(payload);
    });

    it('rejects tokens signed with a different secret', () => {
      const token = jwt.sign(payload, 'different-secret', {
        expiresIn: '8h',
        issuer: 'tee-voting-system',
      });

      expect(() => verifySessionJWT(token)).toThrow(jwt.JsonWebTokenError);
    });

    it('rejects tokens from a different issuer', () => {
      const token = jwt.sign(payload, testSecret, {
        expiresIn: '8h',
        issuer: 'another-system',
      });

      expect(() => verifySessionJWT(token)).toThrow(jwt.JsonWebTokenError);
    });

    it('rejects expired tokens', () => {
      const token = jwt.sign(payload, testSecret, {
        expiresIn: '-1s',
        issuer: 'tee-voting-system',
      });

      expect(() => verifySessionJWT(token)).toThrow(jwt.TokenExpiredError);
    });
  });
});
