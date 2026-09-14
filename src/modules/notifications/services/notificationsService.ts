import nodemailer from 'nodemailer';
import { notificationRepository } from '../repositories/notificationRepository';
import { SendNotificationDTO } from '../models/notificationModel';
import { findElectionById, syncAutomaticStatuses } from '../../elections/repositories/electionRepository';
import { AppError } from '../../../errors/appError';
import { badRequest, conflict, notFound, withMeta } from '../../../errors/httpErrors';

export const notificationsService = {
    async sendNotifications({ electionId, emailType, message }: SendNotificationDTO) {
        await syncAutomaticStatuses();
        const election = await findElectionById(electionId);
        if (!election) throw notFound('ELECTION_NOT_FOUND', 'Elección no encontrada');
        if (emailType !== 'custom' && election.status !== 'OPEN') {
            throw conflict('ELECTION_NOT_OPEN', 'La votación debe estar abierta para enviar este aviso.');
        }

        const host = process.env.SMTP_HOST;
        const from = process.env.SMTP_FROM;
        const user = process.env.SMTP_USER;
        const pass = process.env.SMTP_PASS;
        const port = Number(process.env.SMTP_PORT || 587);
        if (!host || !from || !Number.isInteger(port) || port < 1 || port > 65535 || Boolean(user) !== Boolean(pass)) {
            throw new AppError({ status: 503, code: 'SMTP_NOT_CONFIGURED', message: 'El servicio de correo no está configurado.' });
        }

        const voters = await notificationRepository.getVoterEmailsByElection(electionId);
        if (voters.length === 0) throw badRequest('NO_RECIPIENTS', 'No hay votantes activos para esta elección.');

        const transporter = nodemailer.createTransport({
            host,
            port,
            secure: port === 465,
            requireTLS: port !== 465,
            ...(user && pass ? { auth: { user, pass } } : {}),
            connectionTimeout: 10000,
            socketTimeout: 30000,
        });
        const subjectMap = {
            reminder: 'Recordatorio de votación',
            open: 'La votación ha iniciado',
            custom: 'Mensaje personalizado',
        };
        const closingDate = election.end_time
            ? new Date(election.end_time).toLocaleString('es-CR', { timeZone: 'America/Costa_Rica' })
            : null;
        const text = emailType === 'custom' ? message : [
            emailType === 'open' ? `La votación «${election.title}» ha iniciado.` : `La votación «${election.title}» sigue abierta.`,
            closingDate ? `Cierre: ${closingDate}.` : '',
            'Ingresa al sistema con tu cuenta institucional de Microsoft para votar.',
        ].filter(Boolean).join('\n\n');

        let sent = 0;
        let failed = 0;
        // ponytail: envío secuencial; usar una cola si el volumen supera el tiempo de la petición.
        for (const voter of voters) {
            try {
                await transporter.sendMail({ from, to: voter.email, subject: subjectMap[emailType], text });
                sent++;
            } catch {
                failed++;
            }
        }
        if (failed > 0) {
            throw withMeta(502, 'SMTP_SEND_FAILED', `Se enviaron ${sent} de ${voters.length} correos; ${failed} fallaron. Reenviar repetirá los correos entregados.`, { sent, failed, total: voters.length });
        }

        return { message: 'Correos enviados', total: sent };
    },
};
