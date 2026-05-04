import { describe, it, expect } from 'vitest';

import type {
  AuthResponse,
  MicrosoftIdTokenClaims,
  SessionJWTPayload,
} from '../../../src/modules/auth/models/authModel';

describe('authModel', () => {
  describe('MicrosoftIdTokenClaims', () => {
    it('represents the required Microsoft identity token claims', () => {
      const claims = {
        iss: 'https://login.microsoftonline.com/tenant-id/v2.0',
        sub: 'microsoft-subject-id',
        aud: 'azure-client-id',
        exp: 1_735_689_600,
        iat: 1_735_660_800,
      } satisfies MicrosoftIdTokenClaims;

      expect(claims).toEqual({
        iss: 'https://login.microsoftonline.com/tenant-id/v2.0',
        sub: 'microsoft-subject-id',
        aud: 'azure-client-id',
        exp: 1_735_689_600,
        iat: 1_735_660_800,
      });
    });

    it('allows the optional Microsoft profile claims used by auth services', () => {
      const claims = {
        iss: 'https://sts.windows.net/tenant-id/',
        sub: 'microsoft-subject-id',
        aud: 'azure-client-id',
        exp: 1_735_689_600,
        iat: 1_735_660_800,
        email: 'student@estudiantec.cr',
        preferred_username: 'student@estudiantec.cr',
        name: 'Jane Student',
        oid: 'microsoft-object-id',
        tid: 'tenant-id',
      } satisfies MicrosoftIdTokenClaims;

      expect(claims.email).toBe('student@estudiantec.cr');
      expect(claims.preferred_username).toBe('student@estudiantec.cr');
      expect(claims.name).toBe('Jane Student');
      expect(claims.oid).toBe('microsoft-object-id');
      expect(claims.tid).toBe('tenant-id');
    });
  });

  describe('SessionJWTPayload', () => {
    it('represents an admin session payload', () => {
      const payload = {
        studentId: 'student-123',
        carnet: '2020123456',
        email: 'admin@estudiantec.cr',
        fullName: 'Admin User',
        role: 'admin',
      } satisfies SessionJWTPayload;

      expect(payload).toEqual({
        studentId: 'student-123',
        carnet: '2020123456',
        email: 'admin@estudiantec.cr',
        fullName: 'Admin User',
        role: 'admin',
      });
    });

    it('represents a voter session payload', () => {
      const payload = {
        studentId: 'student-456',
        carnet: '2020654321',
        email: 'voter@estudiantec.cr',
        fullName: 'Voter User',
        role: 'voter',
      } satisfies SessionJWTPayload;

      expect(payload.role).toBe('voter');
    });
  });

  describe('AuthResponse', () => {
    it('represents the API response returned after successful authentication', () => {
      const response = {
        token: 'signed-session-jwt',
        user: {
          studentId: 'student-123',
          carnet: '2020123456',
          fullName: 'Jane Student',
          email: 'student@estudiantec.cr',
          role: 'admin',
          sede: 'Central',
          career: 'Ingenieria en Computacion',
        },
      } satisfies AuthResponse;

      expect(response).toEqual({
        token: 'signed-session-jwt',
        user: {
          studentId: 'student-123',
          carnet: '2020123456',
          fullName: 'Jane Student',
          email: 'student@estudiantec.cr',
          role: 'admin',
          sede: 'Central',
          career: 'Ingenieria en Computacion',
        },
      });
    });
  });
});
