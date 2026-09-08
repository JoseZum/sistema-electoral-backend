import { z } from 'zod';
import {
  dateTimeSchema, descriptionSchema, nameSchema, uuidSchema,
  voterFilterSchema, voterSourceSchema,
} from '../../../validation/common';
import { FieldErrors } from '../../../validation/parseInput';

export const createApplicationFormSchema = z.object({
  title: nameSchema,
  description: descriptionSchema.nullable().optional(),
  status: z.enum(['DRAFT', 'SCHEDULED', 'OPEN', 'CLOSED', 'ARCHIVED']).optional(),
  start_time: dateTimeSchema.nullable().optional(),
  end_time: dateTimeSchema.nullable().optional(),
  allow_other_documents: z.boolean().optional(),
  other_documents_label: z.string().max(200).nullable().optional(),
  voter_source: voterSourceSchema,
  voter_filter: voterFilterSchema.nullable().optional(),
  tag_id: uuidSchema.nullable().optional(),
  election_id: uuidSchema.nullable().optional(),
  student_ids: z.array(uuidSchema).optional(),
  positions: z.array(z.string().trim().min(1).max(120)).optional(),
});

export const updateApplicationFormSchema = createApplicationFormSchema.partial();
export const positionSchema = z.object({ name: z.string().trim().min(1).max(120) });

// Los mismos codigos que ya lanzaban los servicios, ahora que el esquema
// rechaza antes de llegar a ellos.
export const applicationFormErrors: { fields: FieldErrors } = {
  fields: {
    title: {
      too_big: {
        code: 'APPLICATION_FORM_TITLE_TOO_LONG',
        message: 'El título del formulario no puede pasar de 200 caracteres',
      },
      '*': {
        code: 'APPLICATION_FORM_TITLE_REQUIRED',
        message: 'El formulario necesita un título',
      },
    },
    voter_source: {
      code: 'APPLICATION_FORM_INVALID_AUDIENCE',
      message: 'Selecciona a quién va dirigido el formulario',
    },
  },
};

export const positionErrors: { fields: FieldErrors } = {
  fields: {
    name: {
      too_big: {
        code: 'APPLICATION_POSITION_NAME_TOO_LONG',
        message: 'El nombre del puesto no puede pasar de 120 caracteres',
      },
      '*': {
        code: 'APPLICATION_POSITION_NAME_REQUIRED',
        message: 'El puesto necesita un nombre',
      },
    },
  },
};

export const reviewApplicationErrors: { fields: FieldErrors } = {
  fields: {
    decision: {
      code: 'APPLICATION_INVALID_DECISION',
      message: 'La decisión debe ser Aprobado, Condicionado o Denegado',
    },
  },
};
export const applicationFiltersSchema = z.object({
  status: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'CONDITIONED', 'REJECTED']).optional(),
});

export const reviewApplicationSchema = z.object({
  decision: z.enum(['APPROVED', 'CONDITIONED', 'REJECTED']),
  comment: descriptionSchema.nullable().optional(),
  unlocked_fields: z.array(z.string().max(100)).optional(),
  correction_deadline: dateTimeSchema.nullable().optional(),
});

// Drafts may be incomplete. Completeness and editable fields depend on the
// application's current state and are checked by the service on save/submit.
const draftText = z.string().max(200).nullable().optional();
export const saveApplicationSchema = z.object({
  last_name_1: draftText,
  last_name_2: draftText,
  first_name: draftText,
  national_id: draftText,
  carnet: draftText,
  phone: draftText,
  sede: draftText,
  career: draftText,
  position_id: z.union([uuidSchema, z.literal('')]).nullable().optional(),
});
