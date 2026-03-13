import jwt from 'jsonwebtoken';
import { env } from '../../../config/env';
import { SessionJWTPayload } from '../models/authModel';

export function createSessionJWT(payload: SessionJWTPayload): string {
  return jwt.sign(payload, env.jwtSecret, {
    expiresIn: '8h',
    issuer: 'tee-voting-system',
  });
}

export function verifySessionJWT(token: string): SessionJWTPayload {
  return jwt.verify(token, env.jwtSecret, {
    issuer: 'tee-voting-system',
  }) as SessionJWTPayload;
}
