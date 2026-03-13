import { Request, Response, NextFunction } from 'express';
import { authenticateWithMicrosoft } from '../services/authService';

export async function microsoftAuthHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { idToken } = req.body;

    if (!idToken || typeof idToken !== 'string') {
      res.status(400).json({ error: 'Falta el idToken o es inválido en el cuerpo de la petición' });
      return;
    }

    const authResponse = await authenticateWithMicrosoft(idToken);
    res.json(authResponse);
  } catch (error) {
    next(error);
  }
}
