import { z } from 'zod';
import { uuidSchema } from '../../../validation/common';
import { FieldErrors } from '../../../validation/parseInput';

export const assignMembersSchema = z.object({
  option: z.enum(['0', '1']),
  students_id: z.array(uuidSchema).min(1),
});

export const submitKeySchema = z.object({
  key: z.string().min(1).max(256),
  memberId: uuidSchema.optional(),
});

// Igual que en las tags: Zod ahora corre antes que scrutinyService, asi que sin
// este mapeo las validaciones que ya tenian codigo propio responderian el
// VALIDATION_ERROR generico.
export const assignMembersErrors: { fields: FieldErrors } = {
  fields: {
    students_id: {
      code: 'SCRUTINY_MEMBERS_REQUIRED',
      message: 'students_id es obligatorio y no puede estar vacío.',
    },
  },
};

export const submitKeyErrors: { fields: FieldErrors } = {
  fields: {
    key: {
      code: 'SCRUTINY_KEY_SUBMISSION_INVALID',
      message: 'Se requiere miembro y llave de escrutinio',
    },
  },
};
