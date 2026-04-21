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

    if (!idToken || typeof idToken !== 'string') {
      next(
        new AppError({
          status: 400,
          code: 'AUTH_INVALID_REQUEST',
          message: 'Falta el idToken o es invalido en el cuerpo de la peticion.',
        })
      );
      return;
    }

    const authResponse = await authenticateWithMicrosoft(idToken);
    res.json(authResponse);
  } catch (error) {
    next(error);
  }
}
