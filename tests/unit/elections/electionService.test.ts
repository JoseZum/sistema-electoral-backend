import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/modules/elections/repositories/electionRepository');
vi.mock('../../../src/modules/tags/services/tagService', () => ({
  getTagById: vi.fn(),
}));
vi.mock('../../../src/config/audit-context', () => ({
  withAuditContext: vi.fn(),
}));
vi.mock('../../../src/config/database', () => ({
  pool: { connect: vi.fn() },
}));
vi.mock('../../../src/modules/voting/services/votingService', () => ({
  prepareAnonymousVotingTokensForElection: vi.fn(),
}));

import * as electionRepo from '../../../src/modules/elections/repositories/electionRepository';
import { getTagById } from '../../../src/modules/tags/services/tagService';
import { withAuditContext } from '../../../src/config/audit-context';
import { pool } from '../../../src/config/database';
import { prepareAnonymousVotingTokensForElection } from '../../../src/modules/voting/services/votingService';
import {
  addOption,
  changeStatus,
  clearVoters,
  createElection,
  deleteElection,
  deleteOption,
  getAllElections,
  getElectionById,
  getMonitoringData,
  getResults,
  populateVoters,
  updateElection,
  updateOption,
} from '../../../src/modules/elections/services/electionService';
import {
  Election,
  ElectionOption,
  ElectionWithStats,
} from '../../../src/modules/elections/models/electionModel';

const actor = {
  id: 'admin-1',
  carnet: '202400001',
  ip: '127.0.0.1',
};

const draftElection: Election = {
  id: 'election-1',
  title: 'Student Council 2026',
  description: 'General election',
  status: 'DRAFT',
  is_anonymous: true,
  auth_method: 'MICROSOFT',
  voter_source: 'FULL_PADRON',
  voter_filter: null,
  tag_id: 'tag-1',
  tag_name: 'Engineering',
  tag_color: '#2563EB',
  tag_description: 'Engineering students',
  tag_member_count: 120,
  starts_immediately: false,
  immediate_minutes: null,
  requires_keys: false,
  min_keys: 1,
  start_time: null,
  end_time: null,
  created_by: 'admin-1',
  created_at: new Date('2026-04-20T10:00:00.000Z'),
  updated_at: new Date('2026-04-25T10:00:00.000Z'),
};

const scheduledElection: Election = {
  ...draftElection,
  status: 'SCHEDULED',
  start_time: new Date('2099-01-01T10:00:00.000Z'),
  end_time: new Date('2099-01-02T10:00:00.000Z'),
};

const openElection: Election = {
  ...scheduledElection,
  status: 'OPEN',
};

const closedElection: Election = {
  ...scheduledElection,
  status: 'CLOSED',
  requires_keys: true,
  min_keys: 2,
};

const scrutinizedElection: Election = {
  ...closedElection,
  status: 'SCRUTINIZED',
};

const electionWithStats: ElectionWithStats = {
  ...scheduledElection,
  total_voters: 120,
  votes_cast: 84,
  options_count: 2,
};

const optionA: ElectionOption = {
  id: 'option-1',
  election_id: 'election-1',
  label: 'Alice',
  option_type: 'ticket',
  display_order: 1,
  metadata: null,
};

const optionB: ElectionOption = {
  ...optionA,
  id: 'option-2',
  label: 'Bob',
  display_order: 2,
};

const mockResults = {
  election: scrutinizedElection,
  options: [
    { id: 'option-1', label: 'Alice', option_type: 'ticket', vote_count: 18, percentage: 60 },
    { id: 'option-2', label: 'Bob', option_type: 'ticket', vote_count: 12, percentage: 40 },
  ],
  total_votes: 30,
  total_eligible: 40,
  participation_rate: 75,
};

describe('electionService', () => {
  let mockClient: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();

    mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    };

    vi.mocked(pool.connect).mockResolvedValue(mockClient as any);
    vi.mocked(withAuditContext).mockImplementation(async (_actor, fn) => fn(mockClient as any));

    vi.mocked(electionRepo.syncAutomaticStatuses).mockResolvedValue(undefined);
    vi.mocked(electionRepo.findAllElections).mockResolvedValue([electionWithStats]);
    vi.mocked(electionRepo.findElectionById).mockResolvedValue(draftElection);
    vi.mocked(electionRepo.findElectionWithStats).mockResolvedValue(electionWithStats);
    vi.mocked(electionRepo.findOptionsByElection).mockResolvedValue([optionA, optionB]);
    vi.mocked(electionRepo.createElection).mockResolvedValue(openElection);
    vi.mocked(electionRepo.updateElection).mockResolvedValue(openElection);
    vi.mocked(electionRepo.deleteElection).mockResolvedValue(true);
    vi.mocked(electionRepo.updateElectionStatus).mockResolvedValue(openElection);
    vi.mocked(electionRepo.createOption).mockResolvedValue(optionA);
    vi.mocked(electionRepo.updateOption).mockResolvedValue(optionA);
    vi.mocked(electionRepo.deleteOption).mockResolvedValue(true);
    vi.mocked(electionRepo.populateVotersFromPadron).mockResolvedValue(10);
    vi.mocked(electionRepo.populateVotersFromTag).mockResolvedValue(10);
    vi.mocked(electionRepo.populateVotersManual).mockResolvedValue(10);
    vi.mocked(electionRepo.getVoterCount).mockResolvedValue({ total: 10, voted: 0 });
    vi.mocked(electionRepo.getSubmittedScrutinyKeyCount).mockResolvedValue(2);
    vi.mocked(electionRepo.clearVoters).mockResolvedValue(undefined);
    vi.mocked(electionRepo.getElectionResults).mockResolvedValue(mockResults);
    vi.mocked(electionRepo.getVotesByHour).mockResolvedValue([
      { hour: '2026-05-01T10:00:00.000Z', count: 5 },
    ]);

    vi.mocked(getTagById).mockResolvedValue({
      id: 'tag-1',
      name: 'Engineering',
      color: '#2563EB',
      description: 'Engineering students',
      member_count: 120,
    } as any);
    vi.mocked(prepareAnonymousVotingTokensForElection).mockResolvedValue(undefined);
  });

  describe('getAllElections', () => {
    it('syncs statuses and returns the repository list', async () => {
      const result = await getAllElections();

      expect(result).toEqual([electionWithStats]);
      expect(electionRepo.syncAutomaticStatuses).toHaveBeenCalledOnce();
      expect(electionRepo.findAllElections).toHaveBeenCalledOnce();
    });
  });

  describe('getElectionById', () => {
    it('returns the election plus its options', async () => {
      const result = await getElectionById('election-1');

      expect(result).toEqual({ ...electionWithStats, options: [optionA, optionB] });
      expect(electionRepo.findElectionWithStats).toHaveBeenCalledWith('election-1');
      expect(electionRepo.findOptionsByElection).toHaveBeenCalledWith('election-1');
    });

    it('throws when the election does not exist', async () => {
      vi.mocked(electionRepo.findElectionWithStats).mockResolvedValue(null);

      await expect(getElectionById('missing-election')).rejects.toMatchObject({
        status: 404,
        code: 'ELECTION_NOT_FOUND',
      });
    });
  });

  describe('createElection', () => {
    it('throws when TAG voter source does not include a tag id', async () => {
      await expect(
        createElection({
          title: 'Tag Election',
          is_anonymous: true,
          voter_source: 'TAG',
        })
      ).rejects.toMatchObject({
        status: 400,
        code: 'ELECTION_TAG_REQUIRED',
      });
    });

    it('throws when publishing with fewer than two options', async () => {
      await expect(
        createElection({
          title: 'Public Election',
          is_anonymous: true,
          voter_source: 'FULL_PADRON',
          status: 'OPEN',
          options: [{ label: 'Only One', option_type: 'ticket' }],
        })
      ).rejects.toMatchObject({
        status: 400,
        code: 'ELECTION_OPTIONS_REQUIRED_FOR_PUBLICATION',
      });
    });

    it('creates a compound filtered election, normalizes options, and prepares anonymous tokens', async () => {
      vi.mocked(electionRepo.createElection).mockResolvedValue({
        ...openElection,
        status: 'OPEN',
        is_anonymous: true,
      });
      vi.mocked(electionRepo.getVoterCount).mockResolvedValue({ total: 15, voted: 0 });

      const result = await createElection({
        title: 'Engineering Election',
        description: 'Vote for your representatives',
        is_anonymous: true,
        voter_source: 'FILTERED',
        voter_filter: { sede: 'Central', career: 'Computacion' },
        status: 'AUTO',
        options: [
          { label: '  Alice   ', option_type: 'ticket' },
          { label: '  Bob  ', option_type: 'ticket', description: '  Candidate  ' },
        ],
      });

      expect(result).toEqual({
        ...openElection,
        status: 'OPEN',
        is_anonymous: true,
      });
      expect(pool.connect).toHaveBeenCalledOnce();
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith(
        'SELECT set_config($1, $2, true)',
        ['app.compound_election_mode', 'true']
      );
      expect(electionRepo.createElection).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Engineering Election',
          status: 'OPEN',
          requires_keys: false,
          min_keys: 1,
          start_time: null,
          end_time: null,
        }),
        undefined,
        mockClient
      );
      expect(electionRepo.createOption).toHaveBeenNthCalledWith(
        1,
        'election-1',
        expect.objectContaining({ label: 'Alice', display_order: 1 }),
        mockClient
      );
      expect(electionRepo.createOption).toHaveBeenNthCalledWith(
        2,
        'election-1',
        expect.objectContaining({ label: 'Bob', description: 'Candidate', display_order: 2 }),
        mockClient
      );
      expect(electionRepo.populateVotersFromPadron).toHaveBeenCalledWith(
        'election-1',
        { sede: 'Central', career: 'Computacion' },
        mockClient
      );
      expect(prepareAnonymousVotingTokensForElection).toHaveBeenCalledWith('election-1');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });

    it('rolls back when a public election ends with zero eligible voters', async () => {
      vi.mocked(electionRepo.createElection).mockResolvedValue(openElection);
      vi.mocked(electionRepo.getVoterCount).mockResolvedValue({ total: 0, voted: 0 });

      await expect(
        createElection({
          title: 'Open Election',
          is_anonymous: true,
          voter_source: 'FULL_PADRON',
          status: 'OPEN',
          options: [
            { label: 'Alice', option_type: 'ticket' },
            { label: 'Bob', option_type: 'ticket' },
          ],
        })
      ).rejects.toMatchObject({
        status: 400,
        code: 'ELECTION_NO_ELIGIBLE_VOTERS',
      });

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(prepareAnonymousVotingTokensForElection).not.toHaveBeenCalled();
    });

    it('uses withAuditContext when an actor is provided', async () => {
      vi.mocked(electionRepo.createElection).mockResolvedValue(draftElection);

      const result = await createElection(
        {
          title: 'Draft Election',
          is_anonymous: false,
          voter_source: 'FULL_PADRON',
        },
        actor
      );

      expect(result).toEqual(draftElection);
      expect(withAuditContext).toHaveBeenCalledWith(
        { id: actor.id, carnet: actor.carnet, ip: actor.ip },
        expect.any(Function)
      );
      expect(electionRepo.createElection).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Draft Election', status: 'DRAFT' }),
        actor.id,
        mockClient
      );
    });
  });

  describe('updateElection', () => {
    it('throws when the election does not exist', async () => {
      vi.mocked(electionRepo.findElectionById).mockResolvedValue(null);

      await expect(updateElection('missing-election', { title: 'Updated' })).rejects.toMatchObject({
        status: 404,
        code: 'ELECTION_NOT_FOUND',
      });
    });

    it('throws when the election is no longer editable', async () => {
      vi.mocked(electionRepo.findElectionById).mockResolvedValue(openElection);

      await expect(updateElection('election-1', { title: 'Updated' })).rejects.toMatchObject({
        status: 409,
        code: 'ELECTION_NOT_EDITABLE',
      });
    });

    it('updates a scheduled election with validated tag and derived scheduled status', async () => {
      const updatedElection: Election = {
        ...scheduledElection,
        title: 'Updated Election',
        tag_id: 'tag-2',
        requires_keys: true,
        min_keys: 3,
      };

      vi.mocked(electionRepo.findElectionById).mockResolvedValue(scheduledElection);
      vi.mocked(electionRepo.updateElection).mockResolvedValue(updatedElection);
      vi.mocked(getTagById).mockResolvedValue({
        id: 'tag-2',
        name: 'Science',
      } as any);

      const result = await updateElection('election-1', {
        title: 'Updated Election',
        tag_id: 'tag-2',
        requires_keys: true,
        min_keys: 3,
        start_time: '2099-02-01T10:00:00.000Z',
        end_time: '2099-02-02T10:00:00.000Z',
      });

      expect(result).toEqual(updatedElection);
      expect(getTagById).toHaveBeenCalledWith('tag-2');
      expect(electionRepo.updateElection).toHaveBeenCalledWith(
        'election-1',
        expect.objectContaining({
          title: 'Updated Election',
          tag_id: 'tag-2',
          requires_keys: true,
          min_keys: 3,
          status: 'SCHEDULED',
          start_time: '2099-02-01T10:00:00.000Z',
          end_time: '2099-02-02T10:00:00.000Z',
        }),
        mockClient
      );
    });
  });

  describe('deleteElection', () => {
    it('deletes the election inside an audited transaction', async () => {
      vi.mocked(electionRepo.findElectionById).mockResolvedValue(draftElection);

      const result = await deleteElection('election-1');

      expect(result).toEqual({ success: true });
      expect(pool.connect).toHaveBeenCalledOnce();
      expect(mockClient.query).toHaveBeenCalledWith('SELECT set_config($1, $2, true)', [
        'app.cascade_election_delete',
        'true',
      ]);
      expect(electionRepo.deleteElection).toHaveBeenCalledWith('election-1', mockClient);
    });

    it('throws when the repository delete fails', async () => {
      vi.mocked(electionRepo.findElectionById).mockResolvedValue(draftElection);
      vi.mocked(electionRepo.deleteElection).mockResolvedValue(false);

      await expect(deleteElection('election-1')).rejects.toMatchObject({
        status: 500,
        code: 'ELECTION_DELETE_FAILED',
      });
    });
  });

  describe('changeStatus', () => {
    it('rejects invalid status transitions', async () => {
      vi.mocked(electionRepo.findElectionById).mockResolvedValue(openElection);

      await expect(changeStatus('election-1', 'DRAFT')).rejects.toMatchObject({
        status: 400,
        code: 'ELECTION_INVALID_STATUS_TRANSITION',
      });
    });

    it('requires at least two options before opening an election', async () => {
      vi.mocked(electionRepo.findElectionById).mockResolvedValue(draftElection);
      vi.mocked(electionRepo.findOptionsByElection).mockResolvedValue([optionA]);

      await expect(changeStatus('election-1', 'OPEN')).rejects.toMatchObject({
        status: 400,
        code: 'ELECTION_OPTIONS_REQUIRED_FOR_PUBLICATION',
      });
    });

    it('requires at least one eligible voter before opening an election', async () => {
      vi.mocked(electionRepo.findElectionById).mockResolvedValue(draftElection);
      vi.mocked(electionRepo.findOptionsByElection).mockResolvedValue([optionA, optionB]);
      vi.mocked(electionRepo.getVoterCount).mockResolvedValue({ total: 0, voted: 0 });

      await expect(changeStatus('election-1', 'OPEN')).rejects.toMatchObject({
        status: 400,
        code: 'ELECTION_NO_ELIGIBLE_VOTERS',
      });
    });

    it('requires submitted scrutiny keys before marking an election as scrutinized', async () => {
      vi.mocked(electionRepo.findElectionById).mockResolvedValue(closedElection);
      vi.mocked(electionRepo.getSubmittedScrutinyKeyCount).mockResolvedValue(1);

      await expect(changeStatus('election-1', 'SCRUTINIZED')).rejects.toMatchObject({
        status: 400,
        code: 'ELECTION_SCRUTINY_KEYS_INSUFFICIENT',
      });
    });

    it('auto-opens immediate anonymous elections and prepares voting tokens', async () => {
      vi.mocked(electionRepo.findElectionById).mockResolvedValue({
        ...scheduledElection,
        starts_immediately: true,
        immediate_minutes: 30,
        is_anonymous: true,
      });
      vi.mocked(electionRepo.findOptionsByElection).mockResolvedValue([optionA, optionB]);
      vi.mocked(electionRepo.getVoterCount).mockResolvedValue({ total: 7, voted: 0 });
      vi.mocked(electionRepo.updateElection).mockResolvedValue({
        ...openElection,
        starts_immediately: true,
        immediate_minutes: 30,
        is_anonymous: true,
        status: 'OPEN',
      });

      const result = await changeStatus('election-1', 'AUTO');

      expect(result?.status).toBe('OPEN');
      const payload = vi.mocked(electionRepo.updateElection).mock.calls[0][1] as {
        status: string;
        start_time?: string;
        end_time?: string;
      };
      expect(payload.status).toBe('OPEN');
      expect(typeof payload.start_time).toBe('string');
      expect(typeof payload.end_time).toBe('string');
      expect(new Date(payload.end_time as string).getTime()).toBeGreaterThan(new Date(payload.start_time as string).getTime());
      expect(prepareAnonymousVotingTokensForElection).toHaveBeenCalledWith('election-1');
    });

    it('allows archiving a closed election when scrutiny keys are not required', async () => {
      vi.mocked(electionRepo.findElectionById).mockResolvedValue({
        ...closedElection,
        requires_keys: false,
      });
      vi.mocked(electionRepo.updateElection).mockResolvedValue({
        ...closedElection,
        requires_keys: false,
        status: 'ARCHIVED',
      });

      const result = await changeStatus('election-1', 'ARCHIVED');

      expect(result?.status).toBe('ARCHIVED');
      expect(electionRepo.updateElection).toHaveBeenCalledWith(
        'election-1',
        expect.objectContaining({ status: 'ARCHIVED' }),
        mockClient
      );
    });
  });

  describe('option management', () => {
    it('adds an option only while the election is editable', async () => {
      vi.mocked(electionRepo.findElectionById).mockResolvedValue(draftElection);

      const result = await addOption('election-1', { label: 'Alice', option_type: 'ticket' });

      expect(result).toEqual(optionA);
      expect(electionRepo.createOption).toHaveBeenCalledWith('election-1', { label: 'Alice', option_type: 'ticket' });
    });

    it('blocks structural option edits after publication', async () => {
      vi.mocked(electionRepo.findElectionById).mockResolvedValue(closedElection);

      await expect(updateOption('election-1', 'option-1', { label: 'Renamed' })).rejects.toMatchObject({
        status: 409,
        code: 'ELECTION_OPTION_STRUCTURE_LOCKED',
      });
    });

    it('allows description-only edits after publication', async () => {
      const updatedOption: ElectionOption = {
        ...optionA,
        metadata: { description: 'Updated description' },
      };

      vi.mocked(electionRepo.findElectionById).mockResolvedValue(closedElection);
      vi.mocked(electionRepo.updateOption).mockResolvedValue(updatedOption);

      const result = await updateOption('election-1', 'option-1', {
        description: 'Updated description',
        metadata: { description: 'Updated description' },
      });

      expect(result).toEqual(updatedOption);
      expect(electionRepo.updateOption).toHaveBeenCalledWith(
        'election-1',
        'option-1',
        {
          description: 'Updated description',
          metadata: { description: 'Updated description' },
        },
        mockClient
      );
    });

    it('deletes options while the election is still editable', async () => {
      vi.mocked(electionRepo.findElectionById).mockResolvedValue(scheduledElection);

      const result = await deleteOption('election-1', 'option-1');

      expect(result).toEqual({ success: true });
      expect(electionRepo.deleteOption).toHaveBeenCalledWith('election-1', 'option-1');
    });
  });

  describe('voter management', () => {
    it('populates voters from a tag and returns updated totals', async () => {
      vi.mocked(electionRepo.findElectionById).mockResolvedValue({
        ...draftElection,
        voter_source: 'TAG',
        tag_id: 'tag-1',
      });
      vi.mocked(electionRepo.populateVotersFromTag).mockResolvedValue(3);
      vi.mocked(electionRepo.getVoterCount).mockResolvedValue({ total: 7, voted: 0 });

      const result = await populateVoters('election-1', {});

      expect(result).toEqual({ added: 3, total: 7 });
      expect(getTagById).toHaveBeenCalledWith('tag-1');
      expect(electionRepo.populateVotersFromTag).toHaveBeenCalledWith('election-1', 'tag-1');
    });

    it('clears voters while the election is editable', async () => {
      vi.mocked(electionRepo.findElectionById).mockResolvedValue(scheduledElection);

      const result = await clearVoters('election-1');

      expect(result).toEqual({ success: true });
      expect(electionRepo.clearVoters).toHaveBeenCalledWith('election-1');
    });
  });

  describe('results and monitoring', () => {
    it('rejects results for elections that are still open', async () => {
      vi.mocked(electionRepo.findElectionById).mockResolvedValue(openElection);

      await expect(getResults('election-1')).rejects.toMatchObject({
        status: 409,
        code: 'ELECTION_RESULTS_NOT_CLOSED',
      });
    });

    it('rejects closed results when scrutiny is still required', async () => {
      vi.mocked(electionRepo.findElectionById).mockResolvedValue(closedElection);

      await expect(getResults('election-1')).rejects.toMatchObject({
        status: 409,
        code: 'ELECTION_RESULTS_REQUIRE_SCRUTINY',
      });
    });

    it('returns results for scrutinized elections', async () => {
      vi.mocked(electionRepo.findElectionById).mockResolvedValue(scrutinizedElection);

      const result = await getResults('election-1');

      expect(result).toEqual(mockResults);
      expect(electionRepo.getElectionResults).toHaveBeenCalledWith('election-1');
    });

    it('rejects monitoring for draft elections', async () => {
      vi.mocked(electionRepo.findElectionById).mockResolvedValue(draftElection);

      await expect(getMonitoringData('election-1')).rejects.toMatchObject({
        status: 409,
        code: 'ELECTION_MONITORING_NOT_AVAILABLE',
      });
    });

    it('returns monitoring data for active elections', async () => {
      vi.mocked(electionRepo.findElectionById).mockResolvedValue(openElection);

      const result = await getMonitoringData('election-1');

      expect(result).toEqual({
        votesByHour: [{ hour: '2026-05-01T10:00:00.000Z', count: 5 }],
      });
      expect(electionRepo.getVotesByHour).toHaveBeenCalledWith('election-1');
    });
  });
});
