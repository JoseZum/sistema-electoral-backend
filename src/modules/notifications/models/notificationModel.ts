import { z } from 'zod';
import { uuidSchema } from '../../../validation/common';

export const sendNotificationSchema = z.object({
    electionId: uuidSchema,
    emailType: z.enum(['reminder', 'open', 'custom']),
    message: z.string().trim().max(5000).default(''),
}).refine((data) => data.emailType !== 'custom' || data.message.length > 0, {
    path: ['message'],
    message: 'Escribe el mensaje personalizado.',
});

export type SendNotificationDTO = z.infer<typeof sendNotificationSchema>;

export interface VoterEmail {
    email: string;
}
