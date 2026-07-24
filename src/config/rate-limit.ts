import crypto from 'crypto';
import type { Request } from 'express';

/**
 * Evita agrupar por IP a usuarios autenticados que comparten una red institucional.
 * Nunca retorna el bearer token original: la clave del limitador usa un hash SHA-256.
 */
export function getGeneralRateLimitKey(req: Request): string {
  const authorization = req.headers.authorization;
  if (authorization?.startsWith('Bearer ')) {
    return `session:${crypto.createHash('sha256').update(authorization).digest('hex')}`;
  }

  return `ip:${req.ip || req.socket.remoteAddress || 'unknown'}`;
}
