import { z } from 'zod';
import { uuidSchema } from '../../../validation/common';

export const voteSelectionSchema = z.object({
  parentOptionId: uuidSchema,
  optionId: uuidSchema,
});

export const castVoteSchema = z.object({
  electionId: uuidSchema,
  optionId: uuidSchema.optional(),
  selections: z.array(voteSelectionSchema).min(1).optional(),
});
