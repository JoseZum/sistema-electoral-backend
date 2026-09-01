import crypto from 'crypto';
import type { Request, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';

function getClientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/**
 * Evita agrupar por IP a usuarios autenticados que comparten una red institucional.
 * Nunca retorna el bearer token original: la clave del limitador usa un hash SHA-256.
 */
export function getGeneralRateLimitKey(req: Request): string {
  const authorization = req.headers.authorization;
  if (authorization?.startsWith('Bearer ')) {
    return `session:${crypto.createHash('sha256').update(authorization).digest('hex')}`;
  }

  return `ip:${getClientIp(req)}`;
}

/**
 * El login todavia no tiene sesion, asi que solo puede agruparse por IP. A diferencia del
 * limitador general NUNCA mira el header Authorization: si lo hiciera, bastaria con mandar un
 * bearer distinto en cada intento para estrenar una cubeta nueva y evadir el limite.
 */
export function getAuthRateLimitKey(req: Request): string {
  return `ip:${getClientIp(req)}`;
}

/**
 * Limitador del login. Solo cuenta intentos FALLIDOS: un login correcto no consume cuota, para
 * que en horas pico un campus entero (misma IP por NAT) no agote el limite votando de verdad.
 * No protege contra fuerza bruta de credenciales — no hay contraseña, el idToken se valida con
 * la firma RS256 de Microsoft — sino contra el martilleo con tokens invalidos o expirados.
 */
export function createAuthLimiter(options: { windowMs: number; max: number }): RequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: getAuthRateLimitKey,
    skipSuccessfulRequests: true,
    message: {
      error: 'Demasiados intentos de autenticación, por favor intente más tarde',
      code: 'AUTH_RATE_LIMIT_EXCEEDED',
    },
  });
}
