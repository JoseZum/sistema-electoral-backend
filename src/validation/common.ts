import { z } from 'zod';

// PostgreSQL accepts UUIDs without requiring a particular version or variant.
export const uuidSchema = z.guid();
export const nameSchema = z.string().trim().min(1).max(200);
export const descriptionSchema = z.string().max(10_000);
export const dateTimeSchema = z.iso.datetime({ offset: true, local: true });
export const voterSourceSchema = z.enum(['FULL_PADRON', 'FILTERED', 'MANUAL', 'TAG']);
export const voterFilterSchema = z.object({
  sede: nameSchema.optional(),
  career: nameSchema.optional(),
});

export function queryInteger(max: number) {
  return z.string().regex(/^\d+$/, 'Debe ser un entero positivo')
    .transform(Number).pipe(z.int().min(1).max(max));
}

export const queryBoolean = z.enum(['true', 'false']).transform((value) => value === 'true');
