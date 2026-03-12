import { Request, Response, NextFunction } from 'express';
import { verifySessionJWT } from '../auth/jwtUtils';
import { SessionJWTPayload } from '../auth/authModel';

declare global {
  namespace Express {
    interface Request {
      user?: SessionJWTPayload;
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = verifySessionJWT(token);
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
