import { Request, Response, NextFunction } from 'express';
import { parseInput } from '../../../validation/parseInput';
import { microsoftAuthSchema } from '../schemas/authSchemas';
import { authenticateWithMicrosoft } from '../services/authService';

export async function microsoftAuthHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { idToken } = parseInput(microsoftAuthSchema, req.body, 'body', {
      code: 'AUTH_INVALID_REQUEST',
      message: 'Falta el idToken o es invalido en el cuerpo de la peticion.',
    });
    const authResponse = await authenticateWithMicrosoft(idToken);
    res.json(authResponse);
  } catch (error) {
    next(error);
  }
}
