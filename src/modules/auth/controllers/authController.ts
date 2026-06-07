import { Request, Response, NextFunction } from 'express';
import { AppError } from '../../../errors/appError';
import { authenticateWithMicrosoft } from '../services/authService';

export async function microsoftAuthHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { idToken } = req.body;

    const invalidRequest = new AppError({
      status: 400,
      code: 'AUTH_INVALID_REQUEST',
      message: 'Falta el idToken o es invalido en el cuerpo de la peticion.',
    });

    if (!idToken || typeof idToken !== 'string') {
      next(invalidRequest);
      return;
    }

    const trimmedIdToken = idToken.trim();
    const jwtShape = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

    if (
      trimmedIdToken.length === 0 ||
      trimmedIdToken.length > 8192 ||
      !jwtShape.test(trimmedIdToken)
    ) {
      next(invalidRequest);
      return;
    }

    const authResponse = await authenticateWithMicrosoft(trimmedIdToken);
    res.json(authResponse);
  } catch (error) {
    next(error);
  }
}
