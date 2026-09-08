import { z } from 'zod';
import { descriptionSchema, nameSchema, uuidSchema } from '../../../validation/common';
import { FieldErrors } from '../../../validation/parseInput';
import { TAG_COLOR_VALUES } from '../constants/tagColors';

export const createTagSchema = z.object({
  name: nameSchema,
  description: descriptionSchema.optional(),
  color: z.string().trim().toUpperCase().pipe(z.enum(TAG_COLOR_VALUES)).optional(),
  student_ids: z.array(uuidSchema).min(1),
});

export const updateTagSchema = createTagSchema.partial();

// Los codigos son los que lanzaba tagService antes de mover la validacion a
// Zod. El cliente los usa para mostrar el mensaje correcto, asi que degradarlos
// a un VALIDATION_ERROR generico romperia la API.
export const tagErrors: { fields: FieldErrors } = {
  fields: {
    name: {
      code: 'TAG_NAME_REQUIRED',
      message: 'Se necesita un nombre para la tag',
    },
    student_ids: {
      code: 'TAG_STUDENTS_REQUIRED',
      message: 'Se necesita al menos un estudiante para crear la tag',
    },
    color: {
      code: 'TAG_INVALID_COLOR',
      message: 'Selecciona un color valido para la tag',
    },
  },
};
