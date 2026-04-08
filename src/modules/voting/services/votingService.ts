import crypto from 'crypto';
import { env } from '../../../config/env';
import * as votingRepo from '../repositories/votingRepository';
import {
  VoterElectionDetail,
  VoteTokenResponse,
  PublicResults,
  GenerateVotingCodesResponse,
} from '../models/votingModel';
import {
  syncAutomaticStatuses,
  findElectionById,
} from '../../elections/repositories/electionRepository';

const tokenEncryptionKey = crypto
  .createHash('sha256')
  .update(`${env.voteTokenSecret}:encrypt`)
  .digest();

function generateVoteToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function generateAccessCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

function normalizeAccessCode(code: string): string {
  const normalized = code.replace(/\D/g, '');
  if (normalized.length !== 6) {
    throw new Error('El código de acceso debe tener 6 dígitos');
  }
  return normalized;
}

function hashAccessCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function hashVoteToken(token: string): string {
  return crypto.createHash('sha256').update(`${token}${env.voteTokenSecret}`).digest('hex');
}

function encryptVoteToken(token: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', tokenEncryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString('hex')}.${encrypted.toString('hex')}.${tag.toString('hex')}`;
}

function decryptVoteToken(payload: string): string {
  const [ivHex, encryptedHex, tagHex] = payload.split('.');
  if (!ivHex || !encryptedHex || !tagHex) {
    throw new Error('Token cifrado inválido');
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    tokenEncryptionKey,
    Buffer.from(ivHex, 'hex')
  );
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, 'hex')),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

async function resolveStudent(email: string) {
  const student = await votingRepo.findStudentIdentityByEmail(email);
  if (!student) {
    throw new Error('Estudiante no encontrado en el padrón');
  }
  return student;
}

function buildVotingTokenRows(
  electionId: string,
  voters: Array<{
    student_id: string;
    carnet: string;
    full_name: string;
    email: string;
  }>
) {
  const codeByStudentId = new Map<string, string>();

  const rows = voters.map((voter) => {
    const code = generateAccessCode();
    const token = generateVoteToken();
    codeByStudentId.set(voter.student_id, code);

    return {
      election_id: electionId,
      student_id: voter.student_id,
      code_hash: hashAccessCode(code),
      token_hash: hashVoteToken(token),
      token_encrypted: encryptVoteToken(token),
    };
  });

  return { rows, codeByStudentId };
}

async function ensureAnonymousVotingTokens(electionId: string): Promise<number> {
  const election = await findElectionById(electionId);
  if (!election || !election.is_anonymous || !['SCHEDULED', 'OPEN'].includes(election.status)) {
    return 0;
  }

  const pendingVoters = await votingRepo.listPendingAnonymousVoters(electionId);
  if (pendingVoters.length === 0) {
    return 0;
  }

  const { rows } = buildVotingTokenRows(electionId, pendingVoters);
  const createdStudentIds = await votingRepo.insertMissingVotingTokens(rows);
  return createdStudentIds.length;
}

export async function generateVotingCodesForElection(electionId: string): Promise<GenerateVotingCodesResponse> {
  await syncAutomaticStatuses();

  const election = await findElectionById(electionId);
  if (!election) {
    throw new Error('Elección no encontrada');
  }
  if (!election.is_anonymous) {
    throw new Error('Solo las elecciones anónimas necesitan códigos de acceso');
  }
  if (!['SCHEDULED', 'OPEN'].includes(election.status)) {
    throw new Error('Solo se pueden generar códigos para elecciones programadas o abiertas');
  }

  const pendingVoters = await votingRepo.listPendingAnonymousVoters(electionId);
  if (pendingVoters.length === 0) {
    return {
      election_id: electionId,
      generated_count: 0,
      pending_voters: 0,
      skipped_used_count: 0,
      codes: [],
    };
  }

  const { rows, codeByStudentId } = buildVotingTokenRows(electionId, pendingVoters);
  const generatedStudentIds = await votingRepo.upsertVotingTokens(rows);
  const generatedSet = new Set(generatedStudentIds);

  return {
    election_id: electionId,
    generated_count: generatedStudentIds.length,
    pending_voters: pendingVoters.length,
    skipped_used_count: 0,
    codes: pendingVoters
      .filter((voter) => generatedSet.has(voter.student_id))
      .map((voter) => ({
        student_id: voter.student_id,
        carnet: voter.carnet,
        full_name: voter.full_name,
        email: voter.email,
        code: codeByStudentId.get(voter.student_id) || '',
      })),
  };
}

export async function getMyElections(email: string) {
  await syncAutomaticStatuses();
  const student = await resolveStudent(email);
  return votingRepo.findElectionsForVoter(student.id);
}

export async function getElectionForVoting(electionId: string, email: string): Promise<VoterElectionDetail> {
  await syncAutomaticStatuses();
  const student = await resolveStudent(email);

  const election = await votingRepo.findElectionForVoting(electionId, student.id);
  if (!election) throw new Error('No tiene acceso a esta elección');

  if (election.is_anonymous && ['SCHEDULED', 'OPEN'].includes(election.status)) {
    await ensureAnonymousVotingTokens(electionId);
  }

  const options = await votingRepo.findElectionOptions(electionId);

  return { ...election, options };
}

export async function requestVoteToken(
  electionId: string,
  email: string,
  code: string,
  carnet?: string
): Promise<VoteTokenResponse> {
  if (typeof code !== 'string') {
    throw new Error('Debe indicar el código de acceso');
  }

  await syncAutomaticStatuses();
  const student = await resolveStudent(email);

  if (carnet && carnet.trim() !== student.carnet) {
    throw new Error('El carnet no coincide con el usuario autenticado');
  }

  const election = await votingRepo.findElectionForVoting(electionId, student.id);
  if (!election) throw new Error('No tiene acceso a esta elección');
  if (election.status !== 'OPEN') throw new Error('La votación no está abierta');
  if (!election.is_anonymous) throw new Error('Esta elección no es anónima, no necesita token');

  await ensureAnonymousVotingTokens(electionId);

  const voterStatus = await votingRepo.getVoterStatus(electionId, student.id);
  if (!voterStatus) throw new Error('No es votante elegible');
  if (voterStatus.token_used) throw new Error('Ya ha emitido su voto');

  const tokenRecord = await votingRepo.findVotingTokenByCode(
    electionId,
    student.id,
    hashAccessCode(normalizeAccessCode(code))
  );
  if (!tokenRecord) {
    throw new Error('Código de acceso inválido');
  }

  return {
    token: decryptVoteToken(tokenRecord.token_encrypted),
    election_id: electionId,
    expires_info: 'El token es de un solo uso y se invalida al emitir el voto.',
  };
}

export async function castVote(data: { electionId: string; optionId: string; token?: string }, email: string) {
  await syncAutomaticStatuses();
  const student = await resolveStudent(email);

  const election = await votingRepo.findElectionForVoting(data.electionId, student.id);
  if (!election) throw new Error('No tiene acceso a esta elección');
  if (election.status !== 'OPEN') throw new Error('La votación no está abierta');

  if (election.has_voted) throw new Error('Ya ha emitido su voto en esta elección');

  if (election.is_anonymous) {
    const tokenRecord = await votingRepo.findVotingTokenByStudent(data.electionId, student.id);
    if (!tokenRecord) throw new Error('No se encontró un token de votación para esta elección');
    const tokenHash = hashVoteToken(decryptVoteToken(tokenRecord.token_encrypted));
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
    try {
      await votingRepo.castNamedVote(data.electionId, data.optionId, student.id);
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
  const student = await resolveStudent(email);

  const election = await votingRepo.findElectionForVoting(electionId, student.id);
  if (!election) throw new Error('No tiene acceso a esta elección');

  const data = await votingRepo.getPublicResults(electionId);
  if (!data) throw new Error('Los resultados aún no están disponibles');

  const totalVotes = data.options.reduce((acc, o) => acc + o.vote_count, 0);

  return {
    election_id: electionId,
    title: data.title,
    options: data.options.map((o) => ({
      ...o,
      percentage: totalVotes > 0 ? (o.vote_count / totalVotes) * 100 : 0,
    })),
    total_votes: totalVotes,
    participation_rate: data.total_eligible > 0 ? (data.total_voted / data.total_eligible) * 100 : 0,
  };
}
