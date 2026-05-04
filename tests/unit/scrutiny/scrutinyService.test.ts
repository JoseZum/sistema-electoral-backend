import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/modules/scrutiny/repositories/scrutinyRepository');
vi.mock('../../../src/modules/elections/repositories/electionRepository');
vi.mock('crypto', () => ({
  randomInt: vi.fn(),
  randomBytes: vi.fn(),
  createHash: vi.fn(),
}));

import * as scrutinyRepository from '../../../src/modules/scrutiny/repositories/scrutinyRepository';
import {
  findElectionById,
  getElectionResults,
  syncAutomaticStatuses,
} from '../../../src/modules/elections/repositories/electionRepository';
import { createHash, randomBytes } from 'crypto';
import {
  addMembersElection,
  finaleElection,
  getOperativeStateElection,
  scrutinyResult,
  submitKey,
} from '../../../src/modules/scrutiny/services/scrutinyService';

const baseElection = {
  id: 'election-1',
  title: 'Student Council 2026',
  description: 'General election',
  status: 'CLOSED',
  is_anonymous: true,
  auth_method: 'MICROSOFT',
  voter_source: 'FULL_PADRON',
  voter_filter: null,
  tag_id: null,
  starts_immediately: false,
  immediate_minutes: null,
  requires_keys: true,
  min_keys: 2,
  start_time: new Date('2026-05-01T10:00:00.000Z'),
  end_time: new Date('2026-05-02T18:00:00.000Z'),
  created_by: 'admin-1',
  created_at: new Date('2026-04-20T10:00:00.000Z'),
  updated_at: new Date('2026-04-25T10:00:00.000Z'),
};

const mockResults = {
  total_votes: 24,
  total_eligible: 30,
  participation_rate: 80,
  options: [
    { id: 'option-1', label: 'Alice', option_type: 'ticket', vote_count: 15, percentage: 62.5 },
    { id: 'option-2', label: 'Bob', option_type: 'ticket', vote_count: 9, percentage: 37.5 },
  ],
};

const mockProgress = {
  total_Members: 3,
  submittedKeys: 1,
  pending: 2,
};

const mockPendingMembers = [
  {
    id: 'student-1',
    full_name: 'Ana Perez',
    carnet: '202400001',
    date: new Date('2026-05-02T18:30:00.000Z'),
    has_submitted: false,
  },
];

const mockSubmittedKey = {
  id: 'scrutiny-key-1',
  election_id: 'election-1',
  member_id: 'student-1',
  key_shard: 'stored-hash',
  has_submitted: true,
  submitted_at: new Date('2026-05-02T18:45:00.000Z'),
};

function mockSha256Digest(): void {
  vi.mocked(createHash).mockImplementation(() => {
    let value = '';
    const chain = {
      update: vi.fn((input: string) => {
        value = input;
        return chain;
      }),
      digest: vi.fn(() => `hashed:${value}`),
    };

    return chain as any;
  });
}

describe('scrutinyService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSha256Digest();

    vi.mocked(syncAutomaticStatuses).mockResolvedValue(undefined);
    vi.mocked(findElectionById).mockResolvedValue(baseElection as any);
    vi.mocked(getElectionResults).mockResolvedValue(mockResults as any);

    vi.mocked(scrutinyRepository.getScrutinyProgress).mockResolvedValue(mockProgress as any);
    vi.mocked(scrutinyRepository.getStateKeys).mockResolvedValue(mockPendingMembers as any);
    vi.mocked(scrutinyRepository.checkKey).mockResolvedValue(true);
    vi.mocked(scrutinyRepository.submitKeys).mockResolvedValue(mockSubmittedKey as any);
    vi.mocked(scrutinyRepository.finalizeScrutine).mockResolvedValue({
      ...baseElection,
      status: 'SCRUTINIZED',
    } as any);
    vi.mocked(scrutinyRepository.addMembersElection).mockResolvedValue(true);
  });

  describe('getOperativeStateElection', () => {
    it('returns the combined scrutiny state for an election', async () => {
      const result = await getOperativeStateElection('election-1');

      expect(result).toEqual({
        electionInfo: {
          id: 'election-1',
          title: 'Student Council 2026',
          status: 'CLOSED',
          requires_keys: true,
          min_keys: 2,
        },
        progressScrutiny: {
          total_Members: 3,
          submittedKeys: 1,
          membersPending: mockPendingMembers,
          can_finalize: false,
        },
        general_Metric: {
          total_votes: 24,
          total_elegibles: 30,
          participation_rate: 80,
        },
        publication_status: 'results_available',
      });
      expect(syncAutomaticStatuses).toHaveBeenCalledOnce();
      expect(findElectionById).toHaveBeenCalledWith('election-1');
      expect(getElectionResults).toHaveBeenCalledWith('election-1');
      expect(scrutinyRepository.getScrutinyProgress).toHaveBeenCalledWith('election-1');
      expect(scrutinyRepository.getStateKeys).toHaveBeenCalledWith('election-1');
    });

    it('marks publication_status as finalized_at for scrutinized elections', async () => {
      vi.mocked(findElectionById).mockResolvedValue({
        ...baseElection,
        status: 'SCRUTINIZED',
      } as any);
      vi.mocked(scrutinyRepository.getScrutinyProgress).mockResolvedValue({
        total_Members: 3,
        submittedKeys: 2,
        pending: 1,
      } as any);

      const result = await getOperativeStateElection('election-1');

      expect(result.progressScrutiny.can_finalize).toBe(true);
      expect(result.publication_status).toBe('finalized_at');
    });

    it('throws not found when the election does not exist', async () => {
      vi.mocked(findElectionById).mockResolvedValue(null);

      await expect(getOperativeStateElection('missing-election')).rejects.toMatchObject({
        status: 404,
        code: 'SCRUTINY_ELECTION_NOT_FOUND',
      });
    });

    it('throws internal error when results cannot be loaded', async () => {
      vi.mocked(getElectionResults).mockResolvedValue(null);

      await expect(getOperativeStateElection('election-1')).rejects.toMatchObject({
        status: 500,
        code: 'SCRUTINY_RESULTS_FETCH_FAILED',
      });
    });

    it('throws internal error when scrutiny progress cannot be loaded', async () => {
      vi.mocked(scrutinyRepository.getScrutinyProgress).mockResolvedValue(null as any);

      await expect(getOperativeStateElection('election-1')).rejects.toMatchObject({
        status: 500,
        code: 'SCRUTINY_PROGRESS_FETCH_FAILED',
      });
    });
  });

  describe('submitKey', () => {
    const payload = {
      election_id: 'election-1',
      member_id: 'student-1',
      key_shard: 'plain-key',
    };

    it('throws bad request when member_id or key_shard is missing', async () => {
      await expect(
        submitKey({ election_id: 'election-1', member_id: '', key_shard: '' })
      ).rejects.toMatchObject({
        status: 400,
        code: 'SCRUTINY_KEY_SUBMISSION_INVALID',
      });
    });

    it('throws not found when the election does not exist', async () => {
      vi.mocked(findElectionById).mockResolvedValue(null);

      await expect(submitKey(payload)).rejects.toMatchObject({
        status: 404,
        code: 'SCRUTINY_ELECTION_NOT_FOUND',
      });
    });

    it('throws conflict when the election does not require scrutiny keys', async () => {
      vi.mocked(findElectionById).mockResolvedValue({
        ...baseElection,
        requires_keys: false,
      } as any);

      await expect(submitKey(payload)).rejects.toMatchObject({
        status: 409,
        code: 'SCRUTINY_KEYS_NOT_REQUIRED',
      });
    });

    it('throws conflict when the election is not closed', async () => {
      vi.mocked(findElectionById).mockResolvedValue({
        ...baseElection,
        status: 'OPEN',
      } as any);

      await expect(submitKey(payload)).rejects.toMatchObject({
        status: 409,
        code: 'SCRUTINY_SUBMIT_ELECTION_NOT_CLOSED',
      });
    });

    it('throws forbidden when the key is invalid', async () => {
      vi.mocked(scrutinyRepository.checkKey).mockResolvedValue(false);

      await expect(submitKey(payload)).rejects.toMatchObject({
        status: 403,
        code: 'SCRUTINY_KEY_INVALID',
      });
      expect(scrutinyRepository.checkKey).toHaveBeenCalledWith(payload, 'hashed:plain-key');
    });

    it('throws not found when the key could not be marked as submitted', async () => {
      vi.mocked(scrutinyRepository.submitKeys).mockResolvedValue(null);

      await expect(submitKey(payload)).rejects.toMatchObject({
        status: 404,
        code: 'SCRUTINY_KEY_NOT_FOUND',
      });
    });

    it('returns submitted=true without finalizing when the minimum key threshold is not met', async () => {
      vi.mocked(scrutinyRepository.getScrutinyProgress).mockResolvedValue({
        total_Members: 3,
        submittedKeys: 1,
        pending: 2,
      } as any);

      const result = await submitKey(payload);

      expect(result).toEqual({ submitted: true, finalized: false });
      expect(scrutinyRepository.finalizeScrutine).not.toHaveBeenCalled();
    });

    it('auto-finalizes the election when the minimum key threshold is reached', async () => {
      vi.mocked(scrutinyRepository.getScrutinyProgress).mockResolvedValue({
        total_Members: 3,
        submittedKeys: 2,
        pending: 1,
      } as any);

      const result = await submitKey(payload);

      expect(result).toEqual({ submitted: true, finalized: true });
      expect(scrutinyRepository.checkKey).toHaveBeenCalledWith(payload, 'hashed:plain-key');
      expect(scrutinyRepository.finalizeScrutine).toHaveBeenCalledWith('election-1', 'student-1');
    });
  });

  describe('addMembersElection', () => {
    it('throws not found when the election does not exist', async () => {
      vi.mocked(findElectionById).mockResolvedValue(null);

      await expect(
        addMembersElection('missing-election', { option: '0', students_id: ['student-1'] })
      ).rejects.toMatchObject({
        status: 404,
        code: 'SCRUTINY_ELECTION_NOT_FOUND',
      });
    });

    it('throws conflict when the election does not require keys', async () => {
      vi.mocked(findElectionById).mockResolvedValue({
        ...baseElection,
        requires_keys: false,
      } as any);

      await expect(
        addMembersElection('election-1', { option: '0', students_id: ['student-1'] })
      ).rejects.toMatchObject({
        status: 409,
        code: 'SCRUTINY_KEYS_NOT_REQUIRED',
      });
    });

    it('throws conflict when the election is not closed', async () => {
      vi.mocked(findElectionById).mockResolvedValue({
        ...baseElection,
        status: 'OPEN',
      } as any);

      await expect(
        addMembersElection('election-1', { option: '0', students_id: ['student-1'] })
      ).rejects.toMatchObject({
        status: 409,
        code: 'SCRUTINY_KEY_GENERATION_ELECTION_NOT_CLOSED',
      });
    });

    it('throws bad request when students_id is empty', async () => {
      await expect(
        addMembersElection('election-1', { option: '0', students_id: [] })
      ).rejects.toMatchObject({
        status: 400,
        code: 'SCRUTINY_MEMBERS_REQUIRED',
      });
    });

    it('throws bad request when student ids are duplicated', async () => {
      await expect(
        addMembersElection('election-1', {
          option: '0',
          students_id: ['student-1', 'student-1'],
        })
      ).rejects.toMatchObject({
        status: 400,
        code: 'SCRUTINY_DUPLICATE_STUDENT_IDS',
      });
    });

    it('generates numeric keys for option 0 and passes hashed values to the repository', async () => {
      vi.mocked(randomBytes)
        .mockReturnValueOnce(Buffer.from([1, 2, 3, 4, 5, 6]))
        .mockReturnValueOnce(Buffer.from([9, 8, 7, 6, 5, 4]));

      const result = await addMembersElection(
        'election-1',
        { option: '0', students_id: ['student-1', 'student-2'] },
        'admin-1'
      );

      expect(result).toEqual({
        result: true,
        keys: ['123456', '987654'],
      });
      expect(scrutinyRepository.addMembersElection).toHaveBeenCalledWith(
        'election-1',
        { option: '0', students_id: ['student-1', 'student-2'] },
        ['hashed:123456', 'hashed:987654'],
        'admin-1'
      );
    });

    it('generates 8-character alphanumeric-style keys for non-zero option values', async () => {
      vi.mocked(randomBytes)
        .mockReturnValueOnce(Buffer.from('deadbeefcafebabe', 'hex'))
        .mockReturnValueOnce(Buffer.from('0123456789abcdef', 'hex'));

      const result = await addMembersElection(
        'election-1',
        { option: '1', students_id: ['student-1', 'student-2'] }
      );

      expect(result).toEqual({
        result: true,
        keys: ['deadbeef', '01234567'],
      });
      expect(scrutinyRepository.addMembersElection).toHaveBeenCalledWith(
        'election-1',
        { option: '1', students_id: ['student-1', 'student-2'] },
        ['hashed:deadbeef', 'hashed:01234567'],
        undefined
      );
    });

    it('throws internal error when the repository fails to save the keys', async () => {
      vi.mocked(randomBytes).mockReturnValue(Buffer.from([1, 2, 3, 4, 5, 6]));
      vi.mocked(scrutinyRepository.addMembersElection).mockResolvedValue(false as any);

      await expect(
        addMembersElection('election-1', { option: '0', students_id: ['student-1'] })
      ).rejects.toMatchObject({
        status: 500,
        code: 'SCRUTINY_KEYS_SAVE_FAILED',
      });
    });
  });

  describe('scrutinyResult', () => {
    it('throws not found when the election does not exist', async () => {
      vi.mocked(findElectionById).mockResolvedValue(null);

      await expect(scrutinyResult('missing-election')).rejects.toMatchObject({
        status: 404,
        code: 'SCRUTINY_ELECTION_NOT_FOUND',
      });
    });

    it('throws conflict when a keyed election has not been finalized', async () => {
      vi.mocked(findElectionById).mockResolvedValue({
        ...baseElection,
        status: 'CLOSED',
        requires_keys: true,
      } as any);

      await expect(scrutinyResult('election-1')).rejects.toMatchObject({
        status: 409,
        code: 'SCRUTINY_RESULTS_NOT_FINALIZED',
      });
    });

    it('throws conflict when a non-keyed election is not yet closed', async () => {
      vi.mocked(findElectionById).mockResolvedValue({
        ...baseElection,
        status: 'OPEN',
        requires_keys: false,
      } as any);

      await expect(scrutinyResult('election-1')).rejects.toMatchObject({
        status: 409,
        code: 'SCRUTINY_RESULTS_ELECTION_NOT_CLOSED',
      });
    });

    it('throws internal error when election results cannot be loaded', async () => {
      vi.mocked(findElectionById).mockResolvedValue({
        ...baseElection,
        status: 'SCRUTINIZED',
      } as any);
      vi.mocked(getElectionResults).mockResolvedValue(null);

      await expect(scrutinyResult('election-1')).rejects.toMatchObject({
        status: 500,
        code: 'SCRUTINY_RESULTS_FETCH_FAILED',
      });
    });

    it('returns scrutiny results when the election is eligible for publication', async () => {
      vi.mocked(findElectionById).mockResolvedValue({
        ...baseElection,
        status: 'SCRUTINIZED',
      } as any);

      const result = await scrutinyResult('election-1');

      expect(result).toEqual({
        id: 'election-1',
        title: 'Student Council 2026',
        total_votes: 24,
        total_elegibles: 30,
        participation_rate: 80,
        options: mockResults.options,
      });
    });
  });

  describe('finaleElection', () => {
    it('returns the existing election without re-finalizing when already scrutinized', async () => {
      vi.mocked(findElectionById).mockResolvedValue({
        ...baseElection,
        status: 'SCRUTINIZED',
      } as any);

      const result = await finaleElection('election-1', 'admin-1');

      expect(result).toEqual({
        ...baseElection,
        status: 'SCRUTINIZED',
      });
      expect(scrutinyRepository.finalizeScrutine).not.toHaveBeenCalled();
    });

    it('delegates finalization to the repository when the election is not yet scrutinized', async () => {
      const finalizedElection = { ...baseElection, status: 'SCRUTINIZED' };
      vi.mocked(scrutinyRepository.finalizeScrutine).mockResolvedValue(finalizedElection as any);

      const result = await finaleElection('election-1', 'admin-1');

      expect(result).toEqual(finalizedElection);
      expect(syncAutomaticStatuses).toHaveBeenCalledOnce();
      expect(scrutinyRepository.finalizeScrutine).toHaveBeenCalledWith('election-1', 'admin-1');
    });
  });
});
