import { Request, Response, NextFunction } from 'express';
import { authenticateWithMicrosoft } from './authService';

export async function microsoftAuthHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { idToken } = req.body;

    if (!idToken || typeof idToken !== 'string') {
      res.status(400).json({ error: 'Missing or invalid idToken in request body' });
      return;
    }

    const authResponse = await authenticateWithMicrosoft(idToken);
    res.json(authResponse);
  } catch (error) {
    next(error);
  }
}
