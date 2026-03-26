import { notificationRepository } from '../repositories/notificationRepository';
import { SendNotificationDTO } from '../models/notificationModel';
import nodemailer from 'nodemailer';

export const notificationsService = {
    async sendNotifications(data: SendNotificationDTO) {
        const { electionId, emailType, message } = data;

        // 1. Obtener correos
        const voters = await notificationRepository.getVoterEmailsByElection(electionId);

        if (!voters || voters.length === 0) {
            throw new Error('No hay votantes para esta elección');
        }

        // 2. Configurar transporter
        const transporter = nodemailer.createTransport({
            host: 'smtp.ethereal.email',
            port: 587,
            auth: {
                user: 'wilton.emmerich78@ethereal.email',
                pass: 'TeuYBeHqXPGgTVAVYd'
            }
        });

        // 3. Definir asunto según tipo
        const subjectMap: Record<string, string> = {
            reminder: 'Recordatorio de votación',
            open: 'La votación ha iniciado',
            custom: 'Mensaje personalizado'
        };

        // 4. Enviar correos uno por uno
        for (const voter of voters) {
            const info = await transporter.sendMail({
                from: '"TEE Votaciones" <no-reply@tee.com>',
                to: voter.email,
                subject: subjectMap[emailType] || 'Notificación',
                text: message || 'Mensaje de prueba'
            });

            console.log('Correo enviado a:', voter.email);
            console.log('Preview URL:', nodemailer.getTestMessageUrl(info));
        }

        return {
            message: 'Correos enviados',
            total: voters.length,
        };
    }
};