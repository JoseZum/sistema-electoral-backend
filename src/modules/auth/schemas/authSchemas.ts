import { z } from 'zod';

export const microsoftAuthSchema = z.object({
  // Signature, issuer, audience and expiry remain the token service's responsibility.
  idToken: z.string().trim().min(1).max(8192)
    .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/),
});
