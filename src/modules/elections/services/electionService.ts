import * as electionRepo from '../repositories/electionRepository';
import {
  CreateElectionDto,
  UpdateElectionDto,
  CreateOptionDto,
  UpdateOptionDto,
  Election,
} from '../models/electionModel';
import { withAuditContext } from '../../../config/audit-context';
import { PoolClient } from 'pg';

type AuditActor = {
  id?: string;
  carnet?: string;
  ip?: string;
};

function isPreOpenStatus(status: Election['status']) {
  return status === 'DRAFT' || status === 'SCHEDULED';
}

const STATUS_TRANSITIONS: Record<string, Election['status'][]> = {
  DRAFT: ['SCHEDULED', 'OPEN', 'CLOSED'],
  SCHEDULED: ['OPEN', 'DRAFT', 'CLOSED'],
  OPEN: ['CLOSED'],
  CLOSED: ['SCRUTINIZED'],
  SCRUTINIZED: ['ARCHIVED'],
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

function validateSchedule(startTime?: string | null, endTime?: string | null) {
  if (!startTime || !endTime) {
    return;
  }

  const start = new Date(startTime);
  const end = new Date(endTime);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Las fechas de la votación no son válidas');
  }

  if (end <= start) {
    throw new Error('La fecha de cierre debe ser posterior a la fecha de apertura');
  }
}

function deriveAutomaticStatus(startTime?: string | null, endTime?: string | null): Election['status'] {
  const now = Date.now();
  const start = startTime ? new Date(startTime).getTime() : null;
  const end = endTime ? new Date(endTime).getTime() : null;

  if (end !== null && !Number.isNaN(end) && end <= now) {
    return 'CLOSED';
  }

  if (start !== null && !Number.isNaN(start) && start > now) {
    return 'SCHEDULED';
  }

  return 'OPEN';
}

function getMergedSchedule(
  election: Election,
  data: UpdateElectionDto
): { startTime: string | null; endTime: string | null } {
  return {
    startTime: data.start_time !== undefined ? data.start_time || null : election.start_time ? election.start_time.toISOString() : null,
    endTime: data.end_time !== undefined ? data.end_time || null : election.end_time ? election.end_time.toISOString() : null,
  };
}

function hasOptionStructureChanges(data: UpdateOptionDto): boolean {
  if (data.label !== undefined || data.option_type !== undefined || data.display_order !== undefined) {
    return true;
  }

  if (data.metadata) {
    return Object.keys(data.metadata).some((key) => key !== 'description');
  }

  return false;
}

export async function getAllElections() {
  await electionRepo.syncAutomaticStatuses();
  return electionRepo.findAllElections();
}

export async function getElectionById(id: string) {
  await electionRepo.syncAutomaticStatuses();
  const election = await electionRepo.findElectionWithStats(id);
  if (!election) throw new Error('Elección no encontrada');
  const options = await electionRepo.findOptionsByElection(id);
  return { ...election, options };
}

export async function createElection(data: CreateElectionDto, createdBy?: string) {
  validateSchedule(data.start_time || null, data.end_time || null);
  return electionRepo.createElection({ ...data, status: 'DRAFT' }, createdBy);
}

export async function updateElection(id: string, data: UpdateElectionDto, actor?: AuditActor) {
  await electionRepo.syncAutomaticStatuses();

  const election = await electionRepo.findElectionById(id);
  if (!election) throw new Error('Elección no encontrada');
  if (!isPreOpenStatus(election.status)) {
    throw new Error('Solo se pueden editar elecciones en borrador o programadas');
  }

  const { startTime, endTime } = getMergedSchedule(election, data);
  validateSchedule(startTime, endTime);

  const nextStatus = election.status === 'DRAFT'
    ? 'DRAFT'
    : deriveAutomaticStatus(startTime, endTime);

  const updated = await withOptionalAudit(actor, (client) =>
    electionRepo.updateElection(id, { ...data, status: nextStatus }, client)
  );

  if (!updated) throw new Error('No se pudo actualizar la elección');
  return updated;
}

export async function deleteElection(id: string) {
  await electionRepo.syncAutomaticStatuses();
  const deleted = await electionRepo.deleteElection(id);
  if (!deleted) throw new Error('Solo se pueden eliminar elecciones en borrador');
  return { success: true };
}

export async function changeStatus(id: string, newStatus: Election['status'] | 'AUTO', actor?: AuditActor) {
  await electionRepo.syncAutomaticStatuses();

  const election = await electionRepo.findElectionById(id);
  if (!election) throw new Error('Elección no encontrada');

  const targetStatus = newStatus === 'AUTO'
    ? deriveAutomaticStatus(
        election.start_time ? election.start_time.toISOString() : null,
        election.end_time ? election.end_time.toISOString() : null
      )
    : newStatus;

  const allowed = STATUS_TRANSITIONS[election.status];
  if (!allowed || !allowed.includes(targetStatus)) {
    throw new Error(`No se puede cambiar de ${election.status} a ${targetStatus}`);
  }

  if (targetStatus === 'OPEN' || targetStatus === 'SCHEDULED') {
    const options = await electionRepo.findOptionsByElection(id);
    if (options.length < 2) throw new Error('Se necesitan al menos 2 opciones para publicar la votación');
    const voterStats = await electionRepo.getVoterCount(id);
    if (voterStats.total === 0) throw new Error('Se necesita al menos 1 votante elegible');
  }

  return withOptionalAudit(actor, (client) => electionRepo.updateElectionStatus(id, targetStatus, client));
}

export async function addOption(electionId: string, data: CreateOptionDto) {
  await electionRepo.syncAutomaticStatuses();
  const election = await electionRepo.findElectionById(electionId);
  if (!election) throw new Error('Elección no encontrada');
  if (!isPreOpenStatus(election.status)) {
    throw new Error('Solo se pueden agregar opciones a elecciones en borrador o programadas');
  }
  return electionRepo.createOption(electionId, data);
}

export async function updateOption(electionId: string, optionId: string, data: UpdateOptionDto, actor?: AuditActor) {
  await electionRepo.syncAutomaticStatuses();

  const election = await electionRepo.findElectionById(electionId);
  if (!election) throw new Error('Elección no encontrada');

  if (!isPreOpenStatus(election.status) && hasOptionStructureChanges(data)) {
    throw new Error('Solo se puede editar la descripción de una opción fuera del borrador');
  }

  const option = await withOptionalAudit(actor, (client) =>
    electionRepo.updateOption(electionId, optionId, data, client)
  );

  if (!option) throw new Error('Opción no encontrada');
  return option;
}

export async function deleteOption(electionId: string, optionId: string) {
  await electionRepo.syncAutomaticStatuses();
  const election = await electionRepo.findElectionById(electionId);
  if (!election) throw new Error('Elección no encontrada');
  if (!isPreOpenStatus(election.status)) {
    throw new Error('Solo se pueden eliminar opciones de elecciones en borrador o programadas');
  }
  const deleted = await electionRepo.deleteOption(electionId, optionId);
  if (!deleted) throw new Error('Opción no encontrada');
  return { success: true };
}

export async function populateVoters(electionId: string, data: { sede?: string; career?: string; student_ids?: string[] }) {
  await electionRepo.syncAutomaticStatuses();
  const election = await electionRepo.findElectionById(electionId);
  if (!election) throw new Error('Elección no encontrada');
  if (!isPreOpenStatus(election.status)) {
    throw new Error('Solo se pueden poblar votantes en elecciones en borrador o programadas');
  }

  let count = 0;
  if (Array.isArray(data.student_ids)) {
    count = await electionRepo.populateVotersManual(electionId, data.student_ids);
  } else {
    count = await electionRepo.populateVotersFromPadron(electionId, { sede: data.sede, career: data.career });
  }
  const stats = await electionRepo.getVoterCount(electionId);
  return { added: count, total: stats.total };
}

export async function clearVoters(electionId: string) {
  await electionRepo.syncAutomaticStatuses();
  const election = await electionRepo.findElectionById(electionId);
  if (!election) throw new Error('Elección no encontrada');
  if (!isPreOpenStatus(election.status)) {
    throw new Error('Solo se pueden limpiar votantes en elecciones en borrador o programadas');
  }
  await electionRepo.clearVoters(electionId);
  return { success: true };
}

export async function getResults(electionId: string) {
  await electionRepo.syncAutomaticStatuses();
  const election = await electionRepo.findElectionById(electionId);
  if (!election) throw new Error('Elección no encontrada');
  if (!['CLOSED', 'SCRUTINIZED', 'ARCHIVED'].includes(election.status)) {
    throw new Error('Los resultados solo están disponibles después de cerrar la votación');
  }
  const results = await electionRepo.getElectionResults(electionId);
  if (!results) throw new Error('No se pudieron obtener los resultados');
  return results;
}
