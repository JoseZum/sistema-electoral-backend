import crypto from 'crypto';
import * as votingRepo from '../repositories/votingRepository';
import { VoterElectionDetail, VoteTokenResponse, PublicResults } from '../models/votingModel';
import { syncAutomaticStatuses } from '../../elections/repositories/electionRepository';

function generateVoteToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function hashVoteToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function getMyElections(email: string) {
  await syncAutomaticStatuses();
  const studentId = await votingRepo.findStudentIdByEmail(email);
  if (!studentId) throw new Error('Estudiante no encontrado en el padrón');
  return votingRepo.findElectionsForVoter(studentId);
}

export async function getElectionForVoting(electionId: string, email: string): Promise<VoterElectionDetail> {
  await syncAutomaticStatuses();
  const studentId = await votingRepo.findStudentIdByEmail(email);
  if (!studentId) throw new Error('Estudiante no encontrado en el padrón');

  const election = await votingRepo.findElectionForVoting(electionId, studentId);
  if (!election) throw new Error('No tiene acceso a esta elección');

  const options = await votingRepo.findElectionOptions(electionId);

  return { ...election, options };
}

export async function requestVoteToken(electionId: string, email: string): Promise<VoteTokenResponse> {
  await syncAutomaticStatuses();
  const studentId = await votingRepo.findStudentIdByEmail(email);
  if (!studentId) throw new Error('Estudiante no encontrado en el padrón');

  const election = await votingRepo.findElectionForVoting(electionId, studentId);
  if (!election) throw new Error('No tiene acceso a esta elección');
  if (election.status !== 'OPEN') throw new Error('La votación no está abierta');
  if (!election.is_anonymous) throw new Error('Esta elección no es anónima, no necesita token');

  const voterStatus = await votingRepo.getVoterStatus(electionId, studentId);
  if (!voterStatus) throw new Error('No es votante elegible');
  if (voterStatus.token_used) throw new Error('Ya ha emitido su voto');
  if (voterStatus.has_token) throw new Error('Ya tiene un token asignado. Úselo para votar.');

  const token = generateVoteToken();
  const tokenHash = hashVoteToken(token);

  const stored = await votingRepo.storeVoteToken(electionId, studentId, tokenHash);
  if (!stored) throw new Error('No se pudo generar el token. Intente de nuevo.');

  return {
    token,
    election_id: electionId,
    expires_info: 'El token es de un solo uso. No lo comparta.',
  };
}

export async function castVote(data: { electionId: string; optionId: string; token?: string }, email: string) {
  await syncAutomaticStatuses();
  const studentId = await votingRepo.findStudentIdByEmail(email);
  if (!studentId) throw new Error('Estudiante no encontrado en el padrón');

  const election = await votingRepo.findElectionForVoting(data.electionId, studentId);
  if (!election) throw new Error('No tiene acceso a esta elección');
  if (election.status !== 'OPEN') throw new Error('La votación no está abierta');

  if (election.is_anonymous) {
    // Anonymous vote via token
    if (!data.token) throw new Error('Se requiere un token para votación anónima');
    const tokenHash = hashVoteToken(data.token);
    try {
      await votingRepo.castAnonymousVote(data.electionId, data.optionId, tokenHash);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('inválido') || msg.includes('utilizado')) {
        throw new Error('Token inválido o ya utilizado');
      }
      throw err;
    }
  } else {
    // Named vote
    if (election.has_voted) throw new Error('Ya ha emitido su voto en esta elección');
    try {
      await votingRepo.castNamedVote(data.electionId, data.optionId, studentId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('duplicate') || msg.includes('unique')) {
        throw new Error('Ya ha emitido su voto en esta elección');
      }
      throw err;
    }
  }

  return { success: true, message: 'Voto emitido exitosamente' };
}

export async function getResults(electionId: string, email: string): Promise<PublicResults> {
  await syncAutomaticStatuses();
  const studentId = await votingRepo.findStudentIdByEmail(email);
  if (!studentId) throw new Error('Estudiante no encontrado en el padrón');

  // Verify voter has access to this election
  const election = await votingRepo.findElectionForVoting(electionId, studentId);
  if (!election) throw new Error('No tiene acceso a esta elección');

  const data = await votingRepo.getPublicResults(electionId);
  if (!data) throw new Error('Los resultados aún no están disponibles');

  const totalVotes = data.options.reduce((acc, o) => acc + o.vote_count, 0);

  return {
    election_id: electionId,
    title: data.title,
    options: data.options.map(o => ({
      ...o,
      percentage: totalVotes > 0 ? (o.vote_count / totalVotes) * 100 : 0,
    })),
    total_votes: totalVotes,
    participation_rate: data.total_eligible > 0 ? (data.total_voted / data.total_eligible) * 100 : 0,
  };
}
