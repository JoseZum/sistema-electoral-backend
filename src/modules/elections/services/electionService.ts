import * as electionRepo from '../repositories/electionRepository';
import { getTagById } from '../../tags/services/tagService';
import {
  CreateElectionRequestDto,
  UpdateElectionDto,
  CreateOptionDto,
  UpdateOptionDto,
  Election,
  PopulateVotersDto,
  VotesByHour,       // Necesario para procesar la estadística de monitoreo
  MonitoringData     // El "wrapper" que devuelve el servicio al controlador
} from '../models/electionModel';
import { withAuditContext } from '../../../config/audit-context';
import { PoolClient } from 'pg';
import { pool } from '../../../config/database';
import { prepareAnonymousVotingTokensForElection } from '../../voting/services/votingService';
import { AppError } from '../../../errors/appError';
import { badRequest, conflict, internalError, notFound } from '../../../errors/httpErrors';

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
  ARCHIVED: ['CLOSED', 'SCRUTINIZED'],
};

function canArchiveWithoutScrutiny(election: Election, targetStatus: Election['status']) {
  return election.status === 'CLOSED' && targetStatus === 'ARCHIVED' && !election.requires_keys;
}

async function withOptionalAudit<T>(
  actor: AuditActor | undefined,
  fn: (client?: PoolClient) => Promise<T>
): Promise<T> {
  if (actor?.id || actor?.carnet || actor?.ip) {
    return withAuditContext(actor, (client) => fn(client));
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function setAuditSessionValue(client: PoolClient, key: string, value: string) {
  await client.query('SELECT set_config($1, $2, true)', [key, value]);
}

function validateSchedule(startTime?: string | null, endTime?: string | null) {
  if (!startTime || !endTime) {
    return;
  }

  const start = new Date(startTime);
  const end = new Date(endTime);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new AppError({
      status: 400,
      code: 'ELECTION_INVALID_DATES',
      message: 'Las fechas de la votación no son válidas',
    });
  }

  if (end <= start) {
    throw new AppError({
      status: 400,
      code: 'ELECTION_INVALID_END_BEFORE_START',
      message: 'La fecha de cierre debe ser posterior a la fecha de apertura',
    });
  }
}

function validateImmediateConfig(startsImmediately?: boolean, immediateMinutes?: number | null) {
  if (!startsImmediately) {
    return;
  }

  if (
    typeof immediateMinutes !== 'number'
    || !Number.isInteger(immediateMinutes)
    || immediateMinutes <= 0
    || immediateMinutes > 1440
  ) {
    throw new AppError({
      status: 400,
      code: 'ELECTION_INVALID_IMMEDIATE_DURATION',
      message: 'Se necesita una duración válida para la votación inmediata',
    });
  }
}

function normalizeScrutinyConfig(data: {
  requires_keys?: boolean;
  min_keys?: number | null;
}): { requiresKeys: boolean; minKeys: number } {
  const requiresKeys = data.requires_keys ?? false;
  const minKeys = Number(data.min_keys ?? 1);

  if (typeof requiresKeys !== 'boolean') {
    throw new AppError({
      status: 400,
      code: 'ELECTION_KEY_CONFIG_INVALID',
      message: 'La configuración de llaves de escrutinio no es válida',
    });
  }

  if (!Number.isInteger(minKeys) || minKeys < 1) {
    throw new AppError({
      status: 400,
      code: 'ELECTION_MIN_KEYS_TOO_LOW',
      message: 'La cantidad de llaves de escrutinio debe ser al menos 1',
    });
  }

  return { requiresKeys, minKeys };
}

async function validateScrutinyKeysReady(election: Election) {
  if (!election.requires_keys) {
    return;
  }

  const submittedKeys = await electionRepo.getSubmittedScrutinyKeyCount(election.id);
  if (submittedKeys < election.min_keys) {
    throw new AppError({
      status: 400,
      code: 'ELECTION_SCRUTINY_KEYS_INSUFFICIENT',
      message: 'No se han entregado las llaves necesarias para finalizar el escrutinio',
      details: `Llaves entregadas: ${submittedKeys} / mínimo requerido: ${election.min_keys}`,
    });
  }
}

function buildImmediateWindow(minutes: number | null | undefined): { startTime: string; endTime: string } {
  const start = new Date();
  const end = new Date(start.getTime() + Number(minutes || 0) * 60_000);
  return {
    startTime: start.toISOString(),
    endTime: end.toISOString(),
  };
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

function normalizeOptionLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ');
}

function normalizeCreateOptions(options: CreateOptionDto[] | undefined): CreateOptionDto[] {
  if (!options) {
    return [];
  }

  return options.map((option) => ({
    ...option,
    label: normalizeOptionLabel(option.label || ''),
    description: option.description?.trim() || undefined,
  }));
}

function validateCreateOptions(options: CreateOptionDto[]) {
  const emptyOption = options.find((option) => !option.label);
  if (emptyOption) {
    throw new AppError({
      status: 400,
      code: 'ELECTION_OPTIONS_EMPTY_LABEL',
      message: 'Todas las opciones deben tener nombre',
    });
  }

  const uniqueLabels = new Set(options.map((option) => option.label.toLowerCase()));
  if (uniqueLabels.size !== options.length) {
    throw new AppError({
      status: 400,
      code: 'ELECTION_OPTIONS_DUPLICATE',
      message: 'Las opciones de la votación no pueden repetirse',
    });
  }
}

function getPublicationModeLabel(status: Election['status']): string {
  switch (status) {
    case 'OPEN':
      return 'Abierta';
    case 'SCHEDULED':
      return 'Programada';
    case 'CLOSED':
      return 'Cerrada';
    case 'SCRUTINIZED':
      return 'Escrutada';
    case 'ARCHIVED':
      return 'Archivada';
    default:
      return 'Borrador';
  }
}

function describeVoterScope(
  voterSource: Election['voter_source'],
  populate: PopulateVotersDto | undefined,
  voterFilter: Record<string, unknown> | undefined,
  tagName?: string | null
): string {
  switch (voterSource) {
    case 'FULL_PADRON':
      return 'Padron completo';
    case 'FILTERED': {
      const sede = typeof populate?.sede === 'string'
        ? populate.sede
        : typeof voterFilter?.sede === 'string'
          ? voterFilter.sede
          : '';
      const career = typeof populate?.career === 'string'
        ? populate.career
        : typeof voterFilter?.career === 'string'
          ? voterFilter.career
          : '';
      const parts = [
        sede ? `Sede: ${sede}` : null,
        career ? `Carrera: ${career}` : null,
      ].filter(Boolean);

      return parts.length > 0 ? parts.join(' | ') : 'Padron filtrado sin restricciones';
    }
    case 'MANUAL':
      return `${populate?.student_ids?.length || 0} persona(s) seleccionada(s) manualmente`;
    case 'TAG':
      return tagName ? `Tag: ${tagName}` : 'Tag seleccionada';
    default:
      return 'Sin definir';
  }
}

function buildCreationAuditSummary(params: {
  data: CreateElectionRequestDto;
  options: CreateOptionDto[];
  eligibleCount: number;
  tagName?: string | null;
  finalStatus: Election['status'];
}) {
  const { data, options, eligibleCount, tagName, finalStatus } = params;

  return {
    option_count: options.length,
    options_summary: options.map((option) => option.label).join(', '),
    eligible_count: eligibleCount,
    voter_scope: describeVoterScope(data.voter_source, data.populate, data.voter_filter, tagName),
    privacy_mode: data.is_anonymous ? 'Voto anonimo' : 'Voto nominal',
    publication_mode: getPublicationModeLabel(finalStatus),
  };
}

async function enrichElectionCreationAudit(
  client: PoolClient,
  electionId: string,
  summary: Record<string, unknown>
) {
  await client.query(
    `WITH target AS (
       SELECT id
       FROM audit_logs
       WHERE action = 'election.insert'
         AND resource_type = 'election'
         AND resource_id = $1
       ORDER BY created_at DESC
       LIMIT 1
     )
     UPDATE audit_logs al
     SET details = jsonb_set(
       COALESCE(al.details, '{}'::jsonb),
       '{new}',
       COALESCE(al.details -> 'new', '{}'::jsonb) || $2::jsonb
     )
     FROM target
     WHERE al.id = target.id`,
    [electionId, JSON.stringify(summary)]
  );
}

export async function getAllElections() {
  await electionRepo.syncAutomaticStatuses();
  return electionRepo.findAllElections();
}

export async function getElectionById(id: string) {
  await electionRepo.syncAutomaticStatuses();
  const election = await electionRepo.findElectionWithStats(id);
  if (!election) {
    throw new AppError({
      status: 404,
      code: 'ELECTION_NOT_FOUND',
      message: 'Elección no encontrada',
    });
  }
  const options = await electionRepo.findOptionsByElection(id);
  return { ...election, options };
}

export async function createElection(data: CreateElectionRequestDto, actor?: AuditActor) {
  if (data.voter_source === 'TAG' && !data.tag_id) {
    throw badRequest('ELECTION_TAG_REQUIRED', 'Se necesita una tag para crear una votacion por tag');
  }

  const scrutinyConfig = normalizeScrutinyConfig(data);
  let tagName: string | null = null;
  if (data.tag_id) {
    const tag = await getTagById(data.tag_id);
    tagName = tag.name;
  }

  validateImmediateConfig(data.starts_immediately, data.immediate_minutes);

  const scheduleWindow = data.starts_immediately
    ? buildImmediateWindow(data.immediate_minutes)
    : {
        startTime: data.start_time || null,
        endTime: data.end_time || null,
      };

  if (!data.starts_immediately) {
    validateSchedule(scheduleWindow.startTime, scheduleWindow.endTime);
  }

  const options = normalizeCreateOptions(data.options);
  if (options.length > 0) {
    validateCreateOptions(options);
  }

  const populateInput: PopulateVotersDto | undefined = data.populate ?? (
    data.voter_source === 'FILTERED'
      ? {
          sede: typeof data.voter_filter?.sede === 'string' ? data.voter_filter.sede : undefined,
          career: typeof data.voter_filter?.career === 'string' ? data.voter_filter.career : undefined,
        }
      : data.voter_source === 'TAG' && data.tag_id
        ? { tag_id: data.tag_id }
        : undefined
  );

  const isCompoundCreation = options.length > 0 || Boolean(populateInput) || data.status === 'AUTO';
  const finalStatus = data.status === 'AUTO'
    ? deriveAutomaticStatus(scheduleWindow.startTime, scheduleWindow.endTime)
    : (data.status || 'DRAFT');

  if (finalStatus !== 'DRAFT' && options.length < 2) {
    throw badRequest(
      'ELECTION_OPTIONS_REQUIRED_FOR_PUBLICATION',
      'Se necesitan al menos 2 opciones para publicar la votacion'
    );
  }

  const createdElection = await withOptionalAudit(actor, async (client) => {
    if (!client) {
      throw internalError(
        'ELECTION_CREATION_TRANSACTION_FAILED',
        'No se pudo iniciar la transaccion de creacion'
      );
    }

    if (isCompoundCreation) {
      await setAuditSessionValue(client, 'app.compound_election_mode', 'true');
    }

    const created = await electionRepo.createElection({
      ...data,
      status: finalStatus,
      requires_keys: scrutinyConfig.requiresKeys,
      min_keys: scrutinyConfig.minKeys,
      start_time: scheduleWindow.startTime,
      end_time: scheduleWindow.endTime,
    }, actor?.id, client);

    for (let index = 0; index < options.length; index += 1) {
      await electionRepo.createOption(created.id, {
        ...options[index],
        display_order: options[index].display_order ?? index + 1,
      }, client);
    }

    if (isCompoundCreation) {
      switch (data.voter_source) {
        case 'TAG': {
          const tagId = populateInput?.tag_id || data.tag_id;
          if (!tagId) {
            throw badRequest('ELECTION_VOTER_TAG_REQUIRED', 'Se necesita una tag para poblar votantes');
          }
          await electionRepo.populateVotersFromTag(created.id, tagId, client);
          break;
        }
        case 'MANUAL':
          await electionRepo.populateVotersManual(created.id, populateInput?.student_ids || [], client);
          break;
        case 'FILTERED':
          await electionRepo.populateVotersFromPadron(created.id, {
            sede: populateInput?.sede,
            career: populateInput?.career,
          }, client);
          break;
        case 'FULL_PADRON':
          await electionRepo.populateVotersFromPadron(created.id, undefined, client);
          break;
      }
    }

    const voterStats = await electionRepo.getVoterCount(created.id, client);
    if (finalStatus !== 'DRAFT' && voterStats.total === 0) {
      throw new AppError({
        status: 400,
        code: 'ELECTION_NO_ELIGIBLE_VOTERS',
        message: 'Se necesita al menos 1 votante elegible',
      });
    }

    if (isCompoundCreation) {
      await enrichElectionCreationAudit(client, created.id, buildCreationAuditSummary({
        data,
        options,
        eligibleCount: voterStats.total,
        tagName,
        finalStatus,
      }));
    }

    return created;
  });

  if (createdElection.status === 'OPEN' && createdElection.is_anonymous) {
    await prepareAnonymousVotingTokensForElection(createdElection.id);
  }

  return createdElection;
}

export async function updateElection(id: string, data: UpdateElectionDto, actor?: AuditActor) {
  await electionRepo.syncAutomaticStatuses();

  const election = await electionRepo.findElectionById(id);
  if (!election) {
    throw notFound('ELECTION_NOT_FOUND', 'Elección no encontrada');
  }
  if (!isPreOpenStatus(election.status)) {
    throw conflict(
      'ELECTION_NOT_EDITABLE',
      'Solo se pueden editar elecciones en borrador o programadas'
    );
  }

  const { startTime, endTime } = getMergedSchedule(election, data);
  validateImmediateConfig(data.starts_immediately, data.immediate_minutes);

  if (!(data.starts_immediately ?? election.starts_immediately)) {
    validateSchedule(startTime, endTime);
  }

  if ((data.voter_source ?? election.voter_source) === 'TAG' && !(data.tag_id ?? election.tag_id)) {
    throw badRequest('ELECTION_TAG_REQUIRED', 'Se necesita una tag para crear una votacion por tag');
  }

  if (data.tag_id) {
    await getTagById(data.tag_id);
  }

  const scrutinyConfig = normalizeScrutinyConfig({
    requires_keys: data.requires_keys ?? election.requires_keys,
    min_keys: data.min_keys ?? election.min_keys,
  });

  const nextStatus = election.status === 'DRAFT'
    ? 'DRAFT'
    : deriveAutomaticStatus(startTime, endTime);

  const updated = await withOptionalAudit(actor, (client) =>
    electionRepo.updateElection(id, {
      ...data,
      status: nextStatus,
      requires_keys: scrutinyConfig.requiresKeys,
      min_keys: scrutinyConfig.minKeys,
      start_time: data.starts_immediately ? undefined : data.start_time,
      end_time: data.starts_immediately ? undefined : data.end_time,
    }, client)
  );

  if (!updated) {
    throw internalError('ELECTION_UPDATE_FAILED', 'No se pudo actualizar la elección');
  }
  return updated;
}

export async function deleteElection(id: string, actor?: AuditActor) {
  await electionRepo.syncAutomaticStatuses();

  const election = await electionRepo.findElectionById(id);
  if (!election) {
    throw notFound('ELECTION_NOT_FOUND', 'Elección no encontrada');
  }

  const deleted = await withOptionalAudit(actor, (client) =>
    electionRepo.deleteElection(id, client)
  );

  if (!deleted) {
    throw internalError('ELECTION_DELETE_FAILED', 'No se pudo eliminar la votación');
  }

  return { success: true };
}

export async function changeStatus(id: string, newStatus: Election['status'] | 'AUTO', actor?: AuditActor) {
  await electionRepo.syncAutomaticStatuses();

  const election = await electionRepo.findElectionById(id);
  if (!election) {
    throw new AppError({
      status: 404,
      code: 'ELECTION_NOT_FOUND',
      message: 'Elección no encontrada',
    });
  }

  const isReversingFromArchive = election.status === 'ARCHIVED' && newStatus !== 'AUTO';

  // Para una elección inmediata se recalcula la ventana únicamente cuando se está
  // (re)abriendo el flujo. Al desarchivar a CLOSED/SCRUTINIZED no se debe pisar
  // start_time/end_time porque ya pasaron y la elección debe quedarse en su estado
  // post-votación sin reabrirse accidentalmente.
  const immediateWindow = !isReversingFromArchive && election.starts_immediately
    ? (election.immediate_minutes && election.immediate_minutes > 0
        ? buildImmediateWindow(election.immediate_minutes)
        : null)
    : null;

  if (!isReversingFromArchive && election.starts_immediately && !immediateWindow) {
    throw new AppError({
      status: 400,
      code: 'ELECTION_INVALID_IMMEDIATE_DURATION',
      message: 'Se necesita una duración válida para la votación inmediata',
    });
  }

  const targetStatus = newStatus === 'AUTO'
    ? (immediateWindow ? 'OPEN' : deriveAutomaticStatus(
        election.start_time ? election.start_time.toISOString() : null,
        election.end_time ? election.end_time.toISOString() : null
      ))
    : newStatus;

  const allowed = STATUS_TRANSITIONS[election.status];
  const archiveWithoutScrutiny = canArchiveWithoutScrutiny(election, targetStatus);
  if ((!allowed || !allowed.includes(targetStatus)) && !archiveWithoutScrutiny) {
    throw new AppError({
      status: 400,
      code: 'ELECTION_INVALID_STATUS_TRANSITION',
      message: `No se puede cambiar de ${election.status} a ${targetStatus}`,
    });
  }

  if (targetStatus === 'OPEN' || targetStatus === 'SCHEDULED') {
    const options = await electionRepo.findOptionsByElection(id);
    if (options.length < 2) {
      throw badRequest(
        'ELECTION_OPTIONS_REQUIRED_FOR_PUBLICATION',
        'Se necesitan al menos 2 opciones para publicar la votación'
      );
    }
    const voterStats = await electionRepo.getVoterCount(id);
    if (voterStats.total === 0) {
      throw new AppError({
        status: 400,
        code: 'ELECTION_NO_ELIGIBLE_VOTERS',
        message: 'Se necesita al menos 1 votante elegible',
      });
    }
  }

  if (targetStatus === 'SCRUTINIZED') {
    await validateScrutinyKeysReady(election);
  }

  const updatedElection = await withOptionalAudit(actor, (client) =>
    electionRepo.updateElection(id, {
      status: targetStatus,
      start_time: immediateWindow?.startTime,
      end_time: immediateWindow?.endTime,
    }, client)
  );

  if (updatedElection?.status === 'OPEN' && updatedElection.is_anonymous) {
    await prepareAnonymousVotingTokensForElection(id);
  }

  return updatedElection;
}

export async function addOption(electionId: string, data: CreateOptionDto) {
  await electionRepo.syncAutomaticStatuses();
  const election = await electionRepo.findElectionById(electionId);
  if (!election) {
    throw notFound('ELECTION_NOT_FOUND', 'Elección no encontrada');
  }
  if (!isPreOpenStatus(election.status)) {
    throw conflict(
      'ELECTION_OPTION_ADD_FORBIDDEN',
      'Solo se pueden agregar opciones a elecciones en borrador o programadas'
    );
  }
  return electionRepo.createOption(electionId, data);
}

export async function updateOption(electionId: string, optionId: string, data: UpdateOptionDto, actor?: AuditActor) {
  await electionRepo.syncAutomaticStatuses();

  const election = await electionRepo.findElectionById(electionId);
  if (!election) {
    throw notFound('ELECTION_NOT_FOUND', 'Elección no encontrada');
  }

  if (!isPreOpenStatus(election.status) && hasOptionStructureChanges(data)) {
    throw conflict(
      'ELECTION_OPTION_STRUCTURE_LOCKED',
      'Solo se puede editar la descripción de una opción fuera del borrador'
    );
  }

  const option = await withOptionalAudit(actor, (client) =>
    electionRepo.updateOption(electionId, optionId, data, client)
  );

  if (!option) {
    throw notFound('ELECTION_OPTION_NOT_FOUND', 'Opción no encontrada');
  }
  return option;
}

export async function deleteOption(electionId: string, optionId: string) {
  await electionRepo.syncAutomaticStatuses();
  const election = await electionRepo.findElectionById(electionId);
  if (!election) {
    throw notFound('ELECTION_NOT_FOUND', 'Elección no encontrada');
  }
  if (!isPreOpenStatus(election.status)) {
    throw conflict(
      'ELECTION_OPTION_DELETE_FORBIDDEN',
      'Solo se pueden eliminar opciones de elecciones en borrador o programadas'
    );
  }
  const deleted = await electionRepo.deleteOption(electionId, optionId);
  if (!deleted) {
    throw notFound('ELECTION_OPTION_NOT_FOUND', 'Opción no encontrada');
  }
  return { success: true };
}

export async function populateVoters(electionId: string, data: { sede?: string; career?: string; student_ids?: string[]; tag_id?: string }) {
  await electionRepo.syncAutomaticStatuses();
  const election = await electionRepo.findElectionById(electionId);
  if (!election) {
    throw notFound('ELECTION_NOT_FOUND', 'Elección no encontrada');
  }
  if (!isPreOpenStatus(election.status)) {
    throw conflict(
      'ELECTION_VOTERS_POPULATE_FORBIDDEN',
      'Solo se pueden poblar votantes en elecciones en borrador o programadas'
    );
  }

  let count = 0;
  if (data.tag_id || election.voter_source === 'TAG') {
    const tagId = data.tag_id || election.tag_id;
    if (!tagId) {
      throw badRequest('ELECTION_VOTER_TAG_REQUIRED', 'Se necesita una tag para poblar votantes');
    }

    await getTagById(tagId);
    count = await electionRepo.populateVotersFromTag(electionId, tagId);
  } else if (Array.isArray(data.student_ids)) {
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
  if (!election) {
    throw notFound('ELECTION_NOT_FOUND', 'Elección no encontrada');
  }
  if (!isPreOpenStatus(election.status)) {
    throw conflict(
      'ELECTION_VOTERS_CLEAR_FORBIDDEN',
      'Solo se pueden limpiar votantes en elecciones en borrador o programadas'
    );
  }
  await electionRepo.clearVoters(electionId);
  return { success: true };
}

export async function getResults(electionId: string) {
  await electionRepo.syncAutomaticStatuses();
  const election = await electionRepo.findElectionById(electionId);
  if (!election) {
    throw notFound('ELECTION_NOT_FOUND', 'Elección no encontrada');
  }
  if (!['CLOSED', 'SCRUTINIZED', 'ARCHIVED'].includes(election.status)) {
    throw conflict(
      'ELECTION_RESULTS_NOT_CLOSED',
      'Los resultados solo están disponibles después de cerrar la votación'
    );
  }
  if (election.requires_keys && !['SCRUTINIZED', 'ARCHIVED'].includes(election.status)) {
    throw conflict(
      'ELECTION_RESULTS_REQUIRE_SCRUTINY',
      'Los resultados requieren finalizar el escrutinio con las llaves configuradas'
    );
  }
  const results = await electionRepo.getElectionResults(electionId);
  if (!results) {
    throw internalError('ELECTION_RESULTS_FETCH_FAILED', 'No se pudieron obtener los resultados');
  }
  return results;
}

// Estadísticas para monitoreo

export async function getMonitoringData(electionId: string): Promise<MonitoringData> {
  // 1. Sincronizar estados
  await electionRepo.syncAutomaticStatuses();

  // 2. Validar existencia
  const election = await electionRepo.findElectionById(electionId);
  if (!election) {
    throw notFound('ELECTION_NOT_FOUND', 'Elección no encontrada');
  }

  // 3. Validar estado
  if (!['OPEN', 'CLOSED', 'SCRUTINIZED', 'ARCHIVED'].includes(election.status)) {
    throw conflict(
      'ELECTION_MONITORING_NOT_AVAILABLE',
      'El monitoreo solo está disponible para elecciones activas o finalizadas'
    );
  }

  // 4. Obtener datos
  const votesByHour = await electionRepo.getVotesByHour(electionId);

  return {
    votesByHour
  };
}
