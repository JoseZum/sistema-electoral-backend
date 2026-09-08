import { z } from 'zod';
import { uuidSchema } from '../../../validation/common';

export const assignMembersSchema = z.object({
  option: z.enum(['0', '1']),
  students_id: z.array(uuidSchema).min(1),
});

export const submitKeySchema = z.object({
  key: z.string().min(1).max(256),
  memberId: uuidSchema.optional(),
});
