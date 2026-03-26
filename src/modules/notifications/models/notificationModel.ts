export type EmailType = 'reminder' | 'open' | 'custom';

export interface SendNotificationDTO {
    electionId: string;
    emailType: EmailType;
    message: string;
}

export interface VoterEmail {
    email: string;
}