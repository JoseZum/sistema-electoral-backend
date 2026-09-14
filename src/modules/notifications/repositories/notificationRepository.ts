import { pool } from '../../../config/database';
import { VoterEmail } from '../models/notificationModel';

export const notificationRepository = {
    async getVoterEmailsByElection(electionId: string): Promise<VoterEmail[]> {
        const result = await pool.query(
            `
            SELECT DISTINCT s.email
            FROM election_voters ev
            JOIN students s ON ev.student_id = s.id
            WHERE ev.election_id = $1
              AND s.is_active = true
            ORDER BY s.email
            `,
            [electionId]
        );

        return result.rows;
    }
};
