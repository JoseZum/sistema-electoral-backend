import crypto from 'crypto';
import { env } from '../../../config/env';
import * as votingRepo from '../repositories/votingRepository';
import { CastVoteDto, PublicResultOption, VoterElectionDetail, PublicResults, VoteSelectionDto } from '../models/votingModel';
import {
  syncAutomaticStatuses,
  findElectionById,
} from '../../elections/repositories/electionRepository';
import { badRequest, conflict, forbidden, internalError, notFound } from '../../../errors/httpErrors';

const tokenEncryptionKey = crypto
  .createHash('sha256')
  .update(`${env.voteTokenSecret}:encrypt`)
  .digest();

function generateVoteToken(): string {
  return crypto.randomBytes(32).toString('hex');
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
    throw internalError('VOTING_ENCRYPTED_TOKEN_INVALID', 'Token cifrado invalido');
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isVoteNotOpenError(error: unknown): boolean {
  return errorMessage(error).includes('votacion no esta abierta');
}

function isSuboptionValidationError(error: unknown): boolean {
  const msg = errorMessage(error);
  return msg.includes('subopcion')
    || msg.includes('subopciones')
    || msg.includes('Seleccione')
    || msg.includes('seleccionar');
}

function normalizeSelections(selections: VoteSelectionDto[] | undefined): VoteSelectionDto[] {
  if (!Array.isArray(selections) || selections.length === 0) {
    throw badRequest(
      'VOTING_SUBOPTION_SELECTIONS_REQUIRED',
      'Debe seleccionar una subopcion por cada grupo de la votacion'
    );
  }

  const normalized = selections.map((selection) => ({
    parentOptionId: String(selection.parentOptionId || '').trim(),
    optionId: String(selection.optionId || '').trim(),
  }));

  if (normalized.some((selection) => !selection.parentOptionId || !selection.optionId)) {
    throw badRequest(
      'VOTING_SUBOPTION_SELECTIONS_INVALID',
      'Cada seleccion debe incluir el grupo y la subopcion elegida'
    );
  }

  return normalized;
}

function assertOptionId(optionId: string | undefined): string {
  const normalized = String(optionId || '').trim();
  if (!normalized) {
    throw badRequest('VOTING_OPTION_REQUIRED', 'Debe seleccionar una opcion para votar');
  }
  return normalized;
}

function withResultPercentages(
  options: PublicResultOption[],
  totalVotes: number,
  allowSuboptions: boolean
): PublicResultOption[] {
  if (!allowSuboptions) {
    return options.map((option) => ({
      ...option,
      percentage: totalVotes > 0 ? (option.vote_count / totalVotes) * 100 : 0,
    }));
  }

  return options.map((option) => ({
    ...option,
    percentage: totalVotes > 0 ? (option.vote_count / totalVotes) * 100 : 0,
    suboptions: (option.suboptions || []).map((suboption) => ({
      ...suboption,
      percentage: option.vote_count > 0 ? (suboption.vote_count / option.vote_count) * 100 : 0,
    })),
  }));
}

async function resolveStudent(email: string) {
  const student = await votingRepo.findStudentIdentityByEmail(email);
  if (!student) {
    throw notFound('VOTING_STUDENT_NOT_FOUND', 'Estudiante no encontrado en el padron');
  }
  return student;
}

function buildVotingTokenRows(
  electionId: string,
  voters: Array<{
    student_id: string;
    carnet: string;
    full_name: string;
  }>
) {
  return voters.map((voter) => {
    const token = generateVoteToken();

    return {
      election_id: electionId,
      student_id: voter.student_id,
      token_hash: hashVoteToken(token),
      token_encrypted: encryptVoteToken(token),
    };
  });
}

export async function prepareAnonymousVotingTokensForElection(electionId: string): Promise<number> {
  const election = await findElectionById(electionId);
  if (!election || !election.is_anonymous || !['SCHEDULED', 'OPEN'].includes(election.status)) {
    return 0;
  }

  const pendingVoters = await votingRepo.listPendingAnonymousVoters(electionId);
  if (pendingVoters.length === 0) {
    return 0;
  }

  const rows = buildVotingTokenRows(electionId, pendingVoters);
  const createdStudentIds = await votingRepo.insertMissingVotingTokens(rows);
  return createdStudentIds.length;
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
  if (!election) throw forbidden('VOTING_ELECTION_ACCESS_DENIED', 'No tiene acceso a esta eleccion');

  if (election.is_anonymous && ['SCHEDULED', 'OPEN'].includes(election.status)) {
    await prepareAnonymousVotingTokensForElection(electionId);
  }

  const options = await votingRepo.findElectionOptions(electionId);

  return { ...election, options };
}

export async function castVote(data: CastVoteDto, email: string) {
  await syncAutomaticStatuses();
  const student = await resolveStudent(email);

  const election = await votingRepo.findElectionForVoting(data.electionId, student.id);
  if (!election) throw forbidden('VOTING_ELECTION_ACCESS_DENIED', 'No tiene acceso a esta eleccion');
  if (election.status !== 'OPEN') throw conflict('VOTING_NOT_OPEN', 'La votacion no esta abierta');

  if (election.has_voted) throw conflict('VOTING_ALREADY_VOTED', 'Ya ha emitido su voto en esta eleccion');

  const selections = election.allow_suboptions ? normalizeSelections(data.selections) : [];
  const optionId = election.allow_suboptions ? undefined : assertOptionId(data.optionId);

  if (election.is_anonymous) {
    await prepareAnonymousVotingTokensForElection(data.electionId);

    const tokenRecord = await votingRepo.findVotingTokenByStudent(data.electionId, student.id);
    if (!tokenRecord) throw notFound('VOTING_TOKEN_NOT_FOUND', 'No se encontro un token de votacion para esta eleccion');

    const tokenHash = hashVoteToken(decryptVoteToken(tokenRecord.token_encrypted));

    try {
      if (election.allow_suboptions) {
        await votingRepo.castAnonymousSuboptionVotes(data.electionId, selections, tokenHash);
      } else {
        await votingRepo.castAnonymousVote(data.electionId, optionId as string, tokenHash);
      }
    } catch (err: unknown) {
      if (isVoteNotOpenError(err)) {
        throw conflict('VOTING_NOT_OPEN', 'La votacion no esta abierta');
      }
      const msg = errorMessage(err);
      if (msg.includes('invalido') || msg.includes('utilizado')) {
        throw conflict('VOTING_TOKEN_INVALID_OR_USED', 'Token invalido o ya utilizado');
      }
      if (isSuboptionValidationError(err)) {
        throw badRequest('VOTING_SUBOPTION_SELECTIONS_INVALID', 'Las subopciones seleccionadas no son validas');
      }
      throw err;
    }
  } else {
    try {
      if (election.allow_suboptions) {
        await votingRepo.castNamedSuboptionVotes(data.electionId, selections, student.id);
      } else {
        await votingRepo.castNamedVote(data.electionId, optionId as string, student.id);
      }
    } catch (err: unknown) {
      if (isVoteNotOpenError(err)) {
        throw conflict('VOTING_NOT_OPEN', 'La votacion no esta abierta');
      }
      const msg = errorMessage(err);
      if (msg.includes('duplicate') || msg.includes('unique')) {
        throw conflict('VOTING_ALREADY_VOTED', 'Ya ha emitido su voto en esta eleccion');
      }
      if (isSuboptionValidationError(err)) {
        throw badRequest('VOTING_SUBOPTION_SELECTIONS_INVALID', 'Las subopciones seleccionadas no son validas');
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
  if (!election) throw forbidden('VOTING_ELECTION_ACCESS_DENIED', 'No tiene acceso a esta eleccion');

  const data = await votingRepo.getPublicResults(electionId);
  if (!data) throw conflict('VOTING_RESULTS_UNAVAILABLE', 'Los resultados aun no estan disponibles');

  const totalVotes = data.allow_suboptions
    ? data.total_voted
    : data.options.reduce((acc, option) => acc + option.vote_count, 0);

  return {
    election_id: electionId,
    title: data.title,
    options: withResultPercentages(data.options, totalVotes, data.allow_suboptions),
    total_votes: totalVotes,
    participation_rate: data.total_eligible > 0 ? (data.total_voted / data.total_eligible) * 100 : 0,
  };
}
