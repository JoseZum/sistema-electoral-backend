import { Request, Response, NextFunction } from 'express';
import { verifySessionJWT } from '../modules/auth/services/jwtUtils';
import { SessionJWTPayload } from '../modules/auth/models/authModel';
import { Admin } from '../modules/users/models/userModel';

declare global {
  namespace Express {
    interface Request {
      user?: SessionJWTPayload;
      admin?: Admin;
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Falta el header de autorización o es inválido' });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = verifySessionJWT(token);
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}
