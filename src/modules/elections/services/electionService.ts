import * as electionRepo from '../repositories/electionRepository';
import {
  CreateElectionDto,
  UpdateElectionDto,
  CreateOptionDto,
  UpdateOptionDto,
  Election,
} from '../models/electionModel';

// Valid status transitions
const STATUS_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['SCHEDULED'],
  SCHEDULED: ['OPEN', 'DRAFT'],
  OPEN: ['CLOSED'],
  CLOSED: ['SCRUTINIZED'],
  SCRUTINIZED: ['ARCHIVED'],
};

export async function getAllElections() {
  return electionRepo.findAllElections();
}

export async function getElectionById(id: string) {
  const election = await electionRepo.findElectionWithStats(id);
  if (!election) throw new Error('Elección no encontrada');
  const options = await electionRepo.findOptionsByElection(id);
  return { ...election, options };
}

export async function createElection(data: CreateElectionDto, createdBy?: string) {
  return electionRepo.createElection(data, createdBy);
}

export async function updateElection(id: string, data: UpdateElectionDto) {
  const election = await electionRepo.findElectionById(id);
  if (!election) throw new Error('Elección no encontrada');
  if (election.status !== 'DRAFT') throw new Error('Solo se pueden editar elecciones en borrador');
  const updated = await electionRepo.updateElection(id, data);
  if (!updated) throw new Error('No se pudo actualizar la elección');
  return updated;
}

export async function deleteElection(id: string) {
  const deleted = await electionRepo.deleteElection(id);
  if (!deleted) throw new Error('Solo se pueden eliminar elecciones en borrador');
  return { success: true };
}

export async function changeStatus(id: string, newStatus: Election['status']) {
  const election = await electionRepo.findElectionById(id);
  if (!election) throw new Error('Elección no encontrada');

  const allowed = STATUS_TRANSITIONS[election.status];
  if (!allowed || !allowed.includes(newStatus)) {
    throw new Error(`No se puede cambiar de ${election.status} a ${newStatus}`);
  }

  // Validate before opening
  if (newStatus === 'OPEN' || newStatus === 'SCHEDULED') {
    const options = await electionRepo.findOptionsByElection(id);
    if (options.length < 2) throw new Error('Se necesitan al menos 2 opciones para abrir la votación');
    const voterStats = await electionRepo.getVoterCount(id);
    if (voterStats.total === 0) throw new Error('Se necesita al menos 1 votante elegible');
  }

  return electionRepo.updateElectionStatus(id, newStatus);
}

// Options
export async function addOption(electionId: string, data: CreateOptionDto) {
  const election = await electionRepo.findElectionById(electionId);
  if (!election) throw new Error('Elección no encontrada');
  if (election.status !== 'DRAFT') throw new Error('Solo se pueden agregar opciones a elecciones en borrador');
  return electionRepo.createOption(electionId, data);
}

export async function updateOption(electionId: string, optionId: string, data: UpdateOptionDto) {
  const election = await electionRepo.findElectionById(electionId);
  if (!election) throw new Error('Elección no encontrada');
  if (election.status !== 'DRAFT') throw new Error('Solo se pueden editar opciones de elecciones en borrador');
  const option = await electionRepo.updateOption(electionId, optionId, data);
  if (!option) throw new Error('Opción no encontrada');
  return option;
}

export async function deleteOption(electionId: string, optionId: string) {
  const election = await electionRepo.findElectionById(electionId);
  if (!election) throw new Error('Elección no encontrada');
  if (election.status !== 'DRAFT') throw new Error('Solo se pueden eliminar opciones de elecciones en borrador');
  const deleted = await electionRepo.deleteOption(electionId, optionId);
  if (!deleted) throw new Error('Opción no encontrada');
  return { success: true };
}

// Voters
export async function populateVoters(electionId: string, data: { sede?: string; career?: string; student_ids?: string[] }) {
  const election = await electionRepo.findElectionById(electionId);
  if (!election) throw new Error('Elección no encontrada');
  if (election.status !== 'DRAFT') throw new Error('Solo se pueden poblar votantes en elecciones en borrador');

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
  const election = await electionRepo.findElectionById(electionId);
  if (!election) throw new Error('Elección no encontrada');
  if (election.status !== 'DRAFT') throw new Error('Solo se pueden limpiar votantes en elecciones en borrador');
  await electionRepo.clearVoters(electionId);
  return { success: true };
}

// Results
export async function getResults(electionId: string) {
  const election = await electionRepo.findElectionById(electionId);
  if (!election) throw new Error('Elección no encontrada');
  if (!['CLOSED', 'SCRUTINIZED', 'ARCHIVED'].includes(election.status)) {
    throw new Error('Los resultados solo están disponibles después de cerrar la votación');
  }
  const results = await electionRepo.getElectionResults(electionId);
  if (!results) throw new Error('No se pudieron obtener los resultados');
  return results;
}
