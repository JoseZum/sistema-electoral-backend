import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/modules/elections/repositories/electionRepository', () => ({
  syncAutomaticStatuses: vi.fn(),
  createElection: vi.fn(),
  findElectionById: vi.fn(),
  updateElection: vi.fn(),
  findOptionsByElection: vi.fn(),
  getVoterCount: vi.fn(),
  updateElectionStatus: vi.fn(),
  getElectionResults: vi.fn(),
}));

vi.mock('../../src/modules/voting/services/votingService', () => ({
  generateVotingCodesForElection: vi.fn(),
}));

import * as electionRepo from '../../src/modules/elections/repositories/electionRepository';
import { generateVotingCodesForElection } from '../../src/modules/voting/services/votingService';
import {
  createElection,
  updateElection,
  changeStatus,
  getResults,
} from '../../src/modules/elections/services/electionService';
import type { Election } from '../../src/modules/elections/models/electionModel';

function buildElection(overrides: Partial<Election> = {}): Election {
  return {
    id: 'election-1',
    title: 'Eleccion General',
    description: null,
    status: 'DRAFT',
    is_anonymous: false,
    auth_method: 'MICROSOFT',
    voter_source: 'MANUAL',
    voter_filter: null,
    requires_keys: false,
    min_keys: 0,
    start_time: null,
    end_time: null,
    created_by: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

describe('electionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(electionRepo.syncAutomaticStatuses).mockResolvedValue(undefined);
  });

  it('createElection validates schedule and rejects invalid range', async () => {
    await expect(
      createElection({
        title: 'Plan 2026',
        is_anonymous: true,
        voter_source: 'MANUAL',
        start_time: '2026-04-10T10:00:00.000Z',
        end_time: '2026-04-09T10:00:00.000Z',
      })
    ).rejects.toThrow('La fecha de cierre debe ser posterior a la fecha de apertura');

    expect(electionRepo.createElection).not.toHaveBeenCalled();
  });

  it('updateElection blocks edits once election is OPEN', async () => {
    vi.mocked(electionRepo.findElectionById).mockResolvedValue(buildElection({ status: 'OPEN' }));

    await expect(updateElection('election-1', { title: 'Nuevo titulo' })).rejects.toThrow(
      'Solo se pueden editar elecciones en borrador o programadas'
    );

    expect(electionRepo.updateElection).not.toHaveBeenCalled();
  });

  it('changeStatus to OPEN requires at least two options', async () => {
    vi.mocked(electionRepo.findElectionById).mockResolvedValue(buildElection({ status: 'DRAFT' }));
    vi.mocked(electionRepo.findOptionsByElection).mockResolvedValue([
      {
        id: 'opt-1',
        election_id: 'election-1',
        label: 'Plan A',
        option_type: 'TICKET',
        display_order: 1,
        metadata: null,
      },
    ]);

    await expect(changeStatus('election-1', 'OPEN')).rejects.toThrow(
      'Se necesitan al menos 2 opciones para publicar la votación'
    );

    expect(electionRepo.getVoterCount).not.toHaveBeenCalled();
    expect(electionRepo.updateElectionStatus).not.toHaveBeenCalled();
  });

  it('changeStatus to OPEN for anonymous election triggers voting code generation', async () => {
    vi.mocked(electionRepo.findElectionById).mockResolvedValue(buildElection({ status: 'DRAFT', is_anonymous: true }));
    vi.mocked(electionRepo.findOptionsByElection).mockResolvedValue([
      {
        id: 'opt-1',
        election_id: 'election-1',
        label: 'Plan A',
        option_type: 'TICKET',
        display_order: 1,
        metadata: null,
      },
      {
        id: 'opt-2',
        election_id: 'election-1',
        label: 'Plan B',
        option_type: 'TICKET',
        display_order: 2,
        metadata: null,
      },
    ]);
    vi.mocked(electionRepo.getVoterCount).mockResolvedValue({ total: 10, used: 0 });
    vi.mocked(electionRepo.updateElectionStatus).mockResolvedValue(
      buildElection({ status: 'OPEN', is_anonymous: true })
    );
    vi.mocked(generateVotingCodesForElection).mockResolvedValue({
      election_id: 'election-1',
      generated_count: 0,
      pending_voters: 0,
      skipped_used_count: 0,
      codes: [],
    });

    const result = await changeStatus('election-1', 'OPEN');

    expect(electionRepo.updateElectionStatus).toHaveBeenCalledWith('election-1', 'OPEN', undefined);
    expect(generateVotingCodesForElection).toHaveBeenCalledWith('election-1');
    expect(result?.status).toBe('OPEN');
  });

  it('getResults rejects election that is not closed yet', async () => {
    vi.mocked(electionRepo.findElectionById).mockResolvedValue(buildElection({ status: 'OPEN' }));

    await expect(getResults('election-1')).rejects.toThrow(
      'Los resultados solo están disponibles después de cerrar la votación'
    );

    expect(electionRepo.getElectionResults).not.toHaveBeenCalled();
  });
});
