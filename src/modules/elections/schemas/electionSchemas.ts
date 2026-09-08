import { z } from 'zod';
import {
  dateTimeSchema, descriptionSchema, nameSchema, uuidSchema,
  voterFilterSchema, voterSourceSchema,
} from '../../../validation/common';

export const electionStatusSchema = z.enum([
  'DRAFT', 'SCHEDULED', 'OPEN', 'CLOSED', 'SCRUTINIZED', 'ARCHIVED',
]);

const optionFields = z.object({
  label: nameSchema,
  description: descriptionSchema.optional(),
  option_type: nameSchema,
  parent_option_id: uuidSchema.nullable().optional(),
  image_url: z.string().max(5_000_000).nullable().optional(),
  display_order: z.int().min(0).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// Ballots support groups and their choices, a maximum of two levels.
export const createOptionSchema = optionFields.extend({
  suboptions: z.array(optionFields).optional(),
});
export const updateOptionSchema = optionFields.omit({ parent_option_id: true }).partial();

export const populateVotersSchema = voterFilterSchema.extend({
  student_ids: z.array(uuidSchema).optional(),
  tag_id: uuidSchema.optional(),
});

export const createElectionSchema = z.object({
  title: nameSchema,
  description: descriptionSchema.optional(),
  is_anonymous: z.boolean(),
  allow_suboptions: z.boolean().optional(),
  auth_method: z.literal('MICROSOFT').optional(),
  status: z.union([electionStatusSchema, z.literal('AUTO')]).optional(),
  voter_source: voterSourceSchema,
  voter_filter: voterFilterSchema.optional(),
  tag_id: uuidSchema.nullable().optional(),
  starts_immediately: z.boolean().optional(),
  immediate_minutes: z.int().min(1).max(1440).nullable().optional(),
  requires_keys: z.boolean().optional(),
  min_keys: z.int().min(1).nullable().optional(),
  start_time: dateTimeSchema.nullable().optional(),
  end_time: dateTimeSchema.nullable().optional(),
});

export const createElectionRequestSchema = createElectionSchema.extend({
  options: z.array(createOptionSchema).optional(),
  populate: populateVotersSchema.optional(),
});

export const updateElectionSchema = createElectionSchema.partial().extend({
  status: electionStatusSchema.optional(),
});
export const changeElectionStatusSchema = z.object({ status: electionStatusSchema });
export const createSuboptionPresetSchema = z.object({
  name: nameSchema,
  items: z.array(nameSchema).min(2),
});
