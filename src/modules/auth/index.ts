export { microsoftAuthHandler } from './controllers/authController';
export { authenticateWithMicrosoft } from './services/authService';
export { createSessionJWT, verifySessionJWT } from './services/jwtUtils';
export type { AuthResponse, SessionJWTPayload, MicrosoftIdTokenClaims } from './models/authModel';
export { default as authRoutes } from './routes/authRoutes';
