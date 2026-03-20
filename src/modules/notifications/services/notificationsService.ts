import * as electionRepo from '../../elections/repositories/electionRepository';
import * as votingRepo from '../../voting/repositories/votingRepository'; // para los tokens (por implementar)
import { withAuditContext } from '../../../config/audit-context';
import { PoolClient } from 'pg';

type AuditActor = {
    id?: string;
    carnet?: string;
    ip?: string;
};

type SendEmailDto = {
    electionId: string;
    type: 'token' | 'reminder' | 'opening' | 'custom';
    message?: string;
};

async function withOptionalAudit<T>(
    actor: AuditActor | undefined,
    fn: (client?: PoolClient) => Promise<T>
): Promise<T> {
    if (actor?.id || actor?.carnet || actor?.ip) {
        return withAuditContext(actor, (client) => fn(client));
    }

    return fn();
}

async function getValidElection(electionId: string) {
    const election = await electionRepo.findElectionById(electionId);
    if (!election) throw new Error('Elección no encontrada');
    return election;
}

async function getElectionVoters(electionId: string) {
    //return electionRepo.getVotersWithEmails(electionId);
}

async function getVotingTokens(electionId: string) {
    // return votingRepo.getTokensByElection(electionId);
}

// ============================================
// MAIN SERVICE
// ============================================

export async function sendEmails(
    data: SendEmailDto,
    actor?: AuditActor
) {
    const { electionId, type, message } = data;

    const election = await getValidElection(electionId);

    // Aquí se implementaría la lógica para obtener los votantes y tokens según el tipo de email
    
}