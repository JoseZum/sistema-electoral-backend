import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextFunction, Request, Response } from 'express';

vi.mock('../../../src/modules/auth/services/authService');

import { microsoftAuthHandler } from '../../../src/modules/auth/controllers/authController';
import * as authService from '../../../src/modules/auth/services/authService';
import type { AuthResponse } from '../../../src/modules/auth/models/authModel';

function makeRes(): Response {
  const res = {} as any;
  res.json = vi.fn().mockReturnValue(res);
  res.status = vi.fn().mockReturnValue(res);
  return res as Response;
}

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    ...overrides,
  } as Request;
}

function makeNext(): NextFunction {
  return vi.fn() as unknown as NextFunction;
}

describe('authController', () => {
  const authResponse: AuthResponse = {
    token: 'signed-session-jwt',
    user: {
      studentId: 'student-1',
      carnet: '2020123456',
      fullName: 'Jane Student',
      email: 'student@estudiantec.cr',
      role: 'admin',
      sede: 'Central',
      career: 'Ingenieria en Computacion',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('microsoftAuthHandler', () => {
    it('authenticates with Microsoft and responds with the auth payload', async () => {
      vi.mocked(authService.authenticateWithMicrosoft).mockResolvedValue(authResponse);
      const req = makeReq({ body: { idToken: 'microsoft-id-token' } });
      const res = makeRes();
      const next = makeNext();

      await microsoftAuthHandler(req, res, next);

      expect(authService.authenticateWithMicrosoft).toHaveBeenCalledWith('microsoft-id-token');
      expect(res.json).toHaveBeenCalledWith(authResponse);
      expect(next).not.toHaveBeenCalled();
    });

    it.each([
      ['missing', {}],
      ['empty', { idToken: '' }],
      ['non-string', { idToken: 123 }],
    ])('passes a validation error to next when idToken is %s', async (_caseName, body) => {
      const res = makeRes();
      const next = makeNext();

      await microsoftAuthHandler(makeReq({ body }), res, next);

      expect(authService.authenticateWithMicrosoft).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 400,
          code: 'AUTH_INVALID_REQUEST',
          message: 'Falta el idToken o es invalido en el cuerpo de la peticion.',
        })
      );
    });

    it('passes service errors to next', async () => {
      const error = new Error('Auth failed');
      vi.mocked(authService.authenticateWithMicrosoft).mockRejectedValue(error);
      const res = makeRes();
      const next = makeNext();

      await microsoftAuthHandler(makeReq({ body: { idToken: 'invalid-token' } }), res, next);

      expect(authService.authenticateWithMicrosoft).toHaveBeenCalledWith('invalid-token');
      expect(res.json).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(error);
    });
  });
});
