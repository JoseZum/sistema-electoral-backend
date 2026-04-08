import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/modules/voting/repositories/votingRepository', () => ({
  findStudentIdentityByEmail: vi.fn(),
  findElectionsForVoter: vi.fn(),
  findElectionForVoting: vi.fn(),
  getVoterStatus: vi.fn(),
  findVotingTokenByCode: vi.fn(),
  castAnonymousVote: vi.fn(),
  castNamedVote: vi.fn(),
  listPendingAnonymousVoters: vi.fn(),
  insertMissingVotingTokens: vi.fn(),
  getPublicResults: vi.fn(),
}));

vi.mock('../../src/modules/elections/repositories/electionRepository', () => ({
  syncAutomaticStatuses: vi.fn(),
  findElectionById: vi.fn(),
}));

import * as votingRepo from '../../src/modules/voting/repositories/votingRepository';
import * as electionRepo from '../../src/modules/elections/repositories/electionRepository';
import {
  getMyElections,
  requestVoteToken,
  castVote,
  getResults,
} from '../../src/modules/voting/services/votingService';

function mockStudent() {
  vi.mocked(votingRepo.findStudentIdentityByEmail).mockResolvedValue({
    id: 'student-1',
    carnet: 'A001',
    full_name: 'Votante Uno',
    email: 'votante@estudiantec.cr',
  });
}

describe('votingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(electionRepo.syncAutomaticStatuses).mockResolvedValue(undefined);
  });

  it('getMyElections resolves student and returns elections', async () => {
    mockStudent();
    vi.mocked(votingRepo.findElectionsForVoter).mockResolvedValue([
      {
        id: 'e1',
        title: 'Eleccion 1',
        description: null,
        status: 'OPEN',
        is_anonymous: true,
        start_time: null,
        end_time: null,
        has_voted: false,
        total_options: 3,
      },
    ]);

    const result = await getMyElections('votante@estudiantec.cr');

    expect(electionRepo.syncAutomaticStatuses).toHaveBeenCalledTimes(1);
    expect(votingRepo.findElectionsForVoter).toHaveBeenCalledWith('student-1');
    expect(result).toHaveLength(1);
  });

  it('requestVoteToken rejects missing string code', async () => {
    await expect(
      requestVoteToken('election-1', 'votante@estudiantec.cr', undefined as unknown as string)
    ).rejects.toThrow('Debe indicar el código de acceso');
  });

  it('requestVoteToken rejects carnet mismatch', async () => {
    mockStudent();

    await expect(
      requestVoteToken('election-1', 'votante@estudiantec.cr', '123456', 'OTRO-999')
    ).rejects.toThrow('El carnet no coincide con el usuario autenticado');
  });

  it('castVote requires token for anonymous election', async () => {
    mockStudent();
    vi.mocked(votingRepo.findElectionForVoting).mockResolvedValue({
      id: 'e1',
      title: 'Eleccion anonima',
      description: null,
      status: 'OPEN',
      is_anonymous: true,
      start_time: null,
      end_time: null,
      has_voted: false,
    });

    await expect(
      castVote({ electionId: 'e1', optionId: 'opt-1' }, 'votante@estudiantec.cr')
    ).rejects.toThrow('Se requiere un token para votación anónima');
  });

  it('castVote maps duplicate error for named election', async () => {
    mockStudent();
    vi.mocked(votingRepo.findElectionForVoting).mockResolvedValue({
      id: 'e1',
      title: 'Eleccion nominal',
      description: null,
      status: 'OPEN',
      is_anonymous: false,
      start_time: null,
      end_time: null,
      has_voted: false,
    });
    vi.mocked(votingRepo.castNamedVote).mockRejectedValue(new Error('duplicate key value violates unique constraint'));

    await expect(
      castVote({ electionId: 'e1', optionId: 'opt-1' }, 'votante@estudiantec.cr')
    ).rejects.toThrow('Ya ha emitido su voto en esta elección');
  });

  it('getResults calculates percentages and participation', async () => {
    mockStudent();
    vi.mocked(votingRepo.findElectionForVoting).mockResolvedValue({
      id: 'e1',
      title: 'Eleccion nominal',
      description: null,
      status: 'CLOSED',
      is_anonymous: false,
      start_time: null,
      end_time: null,
      has_voted: true,
    });
    vi.mocked(votingRepo.getPublicResults).mockResolvedValue({
      title: 'Eleccion nominal',
      options: [
        { label: 'Plan A', option_type: 'TICKET', vote_count: 2 },
        { label: 'Plan B', option_type: 'TICKET', vote_count: 1 },
      ],
      total_eligible: 5,
      total_voted: 3,
    });

    const result = await getResults('e1', 'votante@estudiantec.cr');

    expect(result.total_votes).toBe(3);
    expect(result.options[0].percentage).toBeCloseTo(66.666, 2);
    expect(result.participation_rate).toBe(60);
  });
});
