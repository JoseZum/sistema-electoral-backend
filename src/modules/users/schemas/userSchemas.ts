import { z } from 'zod';
import { nameSchema, queryBoolean, queryInteger, uuidSchema } from '../../../validation/common';

export const createStudentSchema = z.object({
  carnet: z.string().trim().regex(/^\d+$/).max(30),
  full_name: nameSchema,
  email: z.string().trim().pipe(z.email()),
  sede: nameSchema,
  career: nameSchema,
  degree_level: nameSchema,
});

export const updateStudentSchema = createStudentSchema.omit({ carnet: true }).partial().extend({
  is_active: z.boolean().optional(),
});

export const studentFiltersSchema = z.object({
  sede: nameSchema.optional(),
  career: nameSchema.optional(),
  search: z.string().trim().max(200).optional(),
  is_active: queryBoolean.default(true),
  page: queryInteger(1_000_000).optional(),
  // La exportacion del padron pide una sola pagina con todo el resultado
  // (EXPORT_MAX en el frontend), asi que el tope no puede quedar por debajo.
  limit: queryInteger(100_000).optional(),
});

export const createAdminSchema = z.object({
  students_id: uuidSchema,
  position_title: nameSchema,
  role: nameSchema.optional(),
  permissions: z.record(z.string(), z.boolean()).optional(),
});

export const updateAdminSchema = createAdminSchema.omit({ students_id: true }).partial();
