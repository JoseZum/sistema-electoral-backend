import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearVoters,
  createElection,
  createOption,
  deleteElection,
  deleteOption,
  findAllElections,
  findElectionById,
  findElectionWithStats,
  findOptionsByElection,
  getElectionResults,
  getSubmittedScrutinyKeyCount,
  getVoterCount,
  getVotesByHour,
  populateVotersFromPadron,
  populateVotersFromTag,
  populateVotersManual,
  syncAutomaticStatuses,
  updateElection,
  updateElectionStatus,
  updateOption,
} from '../../../src/modules/elections/repositories/electionRepository';
import {
  CreateElectionDto,
  Election,
  ElectionOption,
  ElectionWithStats,
} from '../../../src/modules/elections/models/electionModel';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('../../../src/config/database', () => ({ pool: mockPool }));

const mockElection: Election = {
  id: 'election-1',
  title: 'Student Council 2026',
  description: 'General student election',
  status: 'OPEN',
  is_anonymous: true,
  allow_suboptions: false,
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
  requires_keys: true,
  min_keys: 2,
  start_time: new Date('2026-05-01T10:00:00.000Z'),
  end_time: new Date('2026-05-02T18:00:00.000Z'),
  created_by: 'admin-1',
  created_at: new Date('2026-04-20T10:00:00.000Z'),
  updated_at: new Date('2026-04-25T10:00:00.000Z'),
};

const mockElectionWithStats: ElectionWithStats = {
  ...mockElection,
  total_voters: 120,
  votes_cast: 84,
  options_count: 3,
};

const mockOption: ElectionOption = {
  id: 'option-1',
  election_id: 'election-1',
  parent_option_id: null,
  label: 'Alice',
  option_type: 'ticket',
  image_url: null,
  display_order: 1,
  metadata: { description: 'Lead candidate', slate: 'Unity' },
};

function makeDb(rows: unknown[], rowCount = rows.length) {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount }) };
}

describe('electionRepository', () => {
  beforeEach(() => {
    mockPool.query.mockReset();
  });

  describe('syncAutomaticStatuses', () => {
    it('updates automatic election statuses in a single query', async () => {
      const db = makeDb([]);

      await syncAutomaticStatuses(db as any);

      expect(db.query).toHaveBeenCalledOnce();
      const sql = db.query.mock.calls[0][0] as string;
      expect(sql).toContain('UPDATE elections');
      expect(sql).toContain("THEN 'CLOSED'::election_status");
      expect(sql).toContain("THEN 'OPEN'::election_status");
      expect(sql).toContain("THEN 'SCHEDULED'::election_status");
    });
  });

  describe('findAllElections', () => {
    it('returns all elections with stats from the pool', async () => {
      mockPool.query.mockResolvedValue({ rows: [mockElectionWithStats] });

      const result = await findAllElections();

      expect(result).toEqual([mockElectionWithStats]);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('COALESCE(ev.total_voters, 0)::int AS total_voters')
      );
    });
  });

  describe('findElectionById', () => {
    it('returns the election when it exists', async () => {
      mockPool.query.mockResolvedValue({ rows: [mockElection] });

      const result = await findElectionById('election-1');

      expect(result).toEqual(mockElection);
      expect(mockPool.query).toHaveBeenCalledWith(expect.stringContaining('WHERE e.id = $1'), ['election-1']);
    });

    it('returns null when the election does not exist', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await findElectionById('missing-election');

      expect(result).toBeNull();
    });
  });

  describe('findElectionWithStats', () => {
    it('returns the election with aggregated stats', async () => {
      mockPool.query.mockResolvedValue({ rows: [mockElectionWithStats] });

      const result = await findElectionWithStats('election-1');

      expect(result).toEqual(mockElectionWithStats);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('COALESCE(eo.options_count, 0)::int AS options_count'),
        ['election-1']
      );
    });
  });

  describe('createElection', () => {
    it('inserts an election using defaults when optional fields are omitted', async () => {
      const db = makeDb([mockElection]);
      const data: CreateElectionDto = {
        title: 'Student Council 2026',
        is_anonymous: true,
        voter_source: 'FULL_PADRON',
      };

      const result = await createElection(data, undefined, db as any);

      expect(result).toEqual(mockElection);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO elections'),
        [
          'Student Council 2026',
          null,
          'DRAFT',
          true,
          false,
          'MICROSOFT',
          'FULL_PADRON',
          null,
          null,
          false,
          null,
          false,
          1,
          null,
          null,
          null,
        ]
      );
    });

    it('serializes explicit election fields before inserting', async () => {
      const db = makeDb([mockElection]);
      const data: CreateElectionDto = {
        title: 'Engineering Election',
        description: 'Vote for your representatives',
        is_anonymous: false,
        allow_suboptions: true,
        status: 'SCHEDULED',
        auth_method: 'MICROSOFT',
        voter_source: 'FILTERED',
        voter_filter: { sede: 'Central', career: 'Computacion' },
        tag_id: 'tag-1',
        starts_immediately: true,
        immediate_minutes: 15,
        requires_keys: true,
        min_keys: 3,
        start_time: '2026-05-01T10:00:00.000Z',
        end_time: '2026-05-02T18:00:00.000Z',
      };

      await createElection(data, 'admin-1', db as any);

      expect(db.query).toHaveBeenCalledWith(
        expect.any(String),
        [
          'Engineering Election',
          'Vote for your representatives',
          'SCHEDULED',
          false,
          true,
          'MICROSOFT',
          'FILTERED',
          JSON.stringify({ sede: 'Central', career: 'Computacion' }),
          'tag-1',
          true,
          15,
          true,
          3,
          '2026-05-01T10:00:00.000Z',
          '2026-05-02T18:00:00.000Z',
          'admin-1',
        ]
      );
    });
  });

  describe('updateElection', () => {
    it('updates provided fields and stamps scrutinized_at when status becomes SCRUTINIZED', async () => {
      const updatedElection: Election = { ...mockElection, title: 'Updated Election', status: 'SCRUTINIZED' };
      const db = makeDb([updatedElection]);

      const result = await updateElection(
        'election-1',
        {
          title: 'Updated Election',
          voter_filter: { sede: 'Central' },
          status: 'SCRUTINIZED',
        },
        db as any
      );

      expect(result).toEqual(updatedElection);
      const sql = db.query.mock.calls[0][0] as string;
      const params = db.query.mock.calls[0][1] as unknown[];
      expect(sql).toContain('title = $1');
      expect(sql).toContain('voter_filter = $2');
      expect(sql).toContain('status = $3');
      expect(sql).toContain('scrutinized_at = COALESCE(scrutinized_at, now())');
      expect(params).toEqual(['Updated Election', JSON.stringify({ sede: 'Central' }), 'SCRUTINIZED', 'election-1']);
    });

    it('falls back to findElectionById when no fields are provided', async () => {
      const db = makeDb([]);
      mockPool.query.mockResolvedValue({ rows: [mockElection] });

      const result = await updateElection('election-1', {}, db as any);

      expect(result).toEqual(mockElection);
      expect(db.query).not.toHaveBeenCalled();
      expect(mockPool.query).toHaveBeenCalledWith(expect.stringContaining('WHERE e.id = $1'), ['election-1']);
    });

    it('returns null when the update does not match any election', async () => {
      const db = makeDb([]);

      const result = await updateElection('missing-election', { title: 'Missing' }, db as any);

      expect(result).toBeNull();
    });
  });

  describe('deleteElection', () => {
    it('returns true when a row was deleted', async () => {
      const db = makeDb([], 1);

      const result = await deleteElection('election-1', db as any);

      expect(result).toBe(true);
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM elections'), ['election-1']);
    });

    it('returns false when no election was deleted', async () => {
      const db = makeDb([], 0);

      const result = await deleteElection('missing-election', db as any);

      expect(result).toBe(false);
    });
  });

  describe('updateElectionStatus', () => {
    it('updates the election status and returns the updated row', async () => {
      const scrutinizedElection: Election = { ...mockElection, status: 'SCRUTINIZED' };
      const db = makeDb([scrutinizedElection]);

      const result = await updateElectionStatus('election-1', 'SCRUTINIZED', db as any);

      expect(result).toEqual(scrutinizedElection);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining("WHEN $1 = 'SCRUTINIZED' THEN COALESCE(scrutinized_at, now())"),
        ['SCRUTINIZED', 'election-1']
      );
    });
  });

  describe('findOptionsByElection', () => {
    it('returns election options ordered by display_order', async () => {
      mockPool.query.mockResolvedValue({ rows: [mockOption] });

      const result = await findOptionsByElection('election-1');

      expect(result).toEqual([{ ...mockOption, suboptions: [] }]);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM election_options eo'),
        ['election-1']
      );
    });
  });

  describe('createOption', () => {
    it('merges description into metadata before inserting', async () => {
      const db = makeDb([mockOption]);

      const result = await createOption(
        'election-1',
        {
          label: 'Alice',
          description: 'Lead candidate',
          option_type: 'ticket',
          display_order: 2,
          metadata: { slate: 'Unity' },
        },
        db as any
      );

      expect(result).toEqual(mockOption);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO election_options'),
        [
          'election-1',
          null,
          'Alice',
          'ticket',
          null,
          2,
          JSON.stringify({ slate: 'Unity', description: 'Lead candidate' }),
        ]
      );
    });

    it('stores null metadata when no metadata or description is provided', async () => {
      const db = makeDb([{ ...mockOption, metadata: null }]);

      await createOption(
        'election-1',
        {
          label: 'Abstain',
          option_type: 'blank',
        },
        db as any
      );

      expect(db.query).toHaveBeenCalledWith(
        expect.any(String),
        ['election-1', null, 'Abstain', 'blank', null, 0, null]
      );
    });
  });

  describe('updateOption', () => {
    it('updates only provided fields and serializes merged metadata', async () => {
      const updatedOption: ElectionOption = {
        ...mockOption,
        label: 'Alice Updated',
        metadata: { slate: 'Unity', description: 'Updated description' },
      };
      const db = makeDb([updatedOption]);

      const result = await updateOption(
        'election-1',
        'option-1',
        {
          label: 'Alice Updated',
          description: 'Updated description',
          metadata: { slate: 'Unity' },
        },
        db as any
      );

      expect(result).toEqual(updatedOption);
      const sql = db.query.mock.calls[0][0] as string;
      const params = db.query.mock.calls[0][1] as unknown[];
      expect(sql).toContain('label = $1');
      expect(sql).toContain('metadata = $2');
      expect(sql).toContain('WHERE id = $3 AND election_id = $4');
      expect(params).toEqual([
        'Alice Updated',
        JSON.stringify({ slate: 'Unity', description: 'Updated description' }),
        'option-1',
        'election-1',
      ]);
    });

    it('returns null without querying when no option fields are provided', async () => {
      const db = makeDb([]);

      const result = await updateOption('election-1', 'option-1', {}, db as any);

      expect(result).toBeNull();
      expect(db.query).not.toHaveBeenCalled();
    });
  });

  describe('deleteOption', () => {
    it('returns true when the option row was deleted', async () => {
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 1 });

      const result = await deleteOption('election-1', 'option-1');

      expect(result).toBe(true);
      expect(mockPool.query).toHaveBeenCalledWith(
        'DELETE FROM election_options WHERE id = $1 AND election_id = $2',
        ['option-1', 'election-1']
      );
    });

    it('returns false when no option matched the delete', async () => {
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      const result = await deleteOption('election-1', 'missing-option');

      expect(result).toBe(false);
    });
  });

  describe('populateVotersFromPadron', () => {
    it('inserts active students matching the provided filters', async () => {
      const db = makeDb([], 8);

      const result = await populateVotersFromPadron(
        'election-1',
        { sede: 'Central', career: 'Computacion' },
        db as any
      );

      expect(result).toBe(8);
      const sql = db.query.mock.calls[0][0] as string;
      const params = db.query.mock.calls[0][1] as unknown[];
      expect(sql).toContain('is_active = true');
      expect(sql).toContain('sede ILIKE $2');
      expect(sql).toContain('career ILIKE $3');
      expect(params).toEqual(['election-1', 'Central', 'Computacion']);
    });

    it('only filters by active students when no filter is provided', async () => {
      const db = makeDb([], 12);

      const result = await populateVotersFromPadron('election-1', undefined, db as any);

      expect(result).toBe(12);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT $1, id FROM students WHERE is_active = true'),
        ['election-1']
      );
    });
  });

  describe('populateVotersFromTag', () => {
    it('inserts active voters from a tag membership', async () => {
      const db = makeDb([], 5);

      const result = await populateVotersFromTag('election-1', 'tag-1', db as any);

      expect(result).toBe(5);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM tag_members tm'),
        ['election-1', 'tag-1']
      );
    });
  });

  describe('populateVotersManual', () => {
    it('returns zero without querying when no student ids are provided', async () => {
      const db = makeDb([]);

      const result = await populateVotersManual('election-1', [], db as any);

      expect(result).toBe(0);
      expect(db.query).not.toHaveBeenCalled();
    });

    it('builds a VALUES list with one placeholder tuple per student', async () => {
      const db = makeDb([], 2);

      const result = await populateVotersManual('election-1', ['student-1', 'student-2'], db as any);

      expect(result).toBe(2);
      const sql = db.query.mock.calls[0][0] as string;
      expect(sql).toContain('VALUES ($1, $2), ($1, $3)');
      expect(db.query).toHaveBeenCalledWith(expect.any(String), ['election-1', 'student-1', 'student-2']);
    });
  });

  describe('getVoterCount', () => {
    it('parses the aggregate counts as numbers', async () => {
      const db = makeDb([{ total: '35', voted: '21' }]);

      const result = await getVoterCount('election-1', db as any);

      expect(result).toEqual({ total: 35, voted: 21 });
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining('COUNT(*) FILTER'), ['election-1']);
    });
  });

  describe('getSubmittedScrutinyKeyCount', () => {
    it('returns the submitted scrutiny key count as a number', async () => {
      const db = makeDb([{ submitted_keys: '4' }]);

      const result = await getSubmittedScrutinyKeyCount('election-1', db as any);

      expect(result).toBe(4);
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining('FROM scrutiny_keys'), ['election-1']);
    });

    it('returns zero when the query result is empty', async () => {
      const db = makeDb([]);

      const result = await getSubmittedScrutinyKeyCount('election-1', db as any);

      expect(result).toBe(0);
    });
  });

  describe('clearVoters', () => {
    it('deletes all voters assigned to the election', async () => {
      const db = makeDb([]);

      await clearVoters('election-1', db as any);

      expect(db.query).toHaveBeenCalledWith('DELETE FROM election_voters WHERE election_id = $1', ['election-1']);
    });
  });

  describe('getElectionResults', () => {
    it('returns null when the election does not exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await getElectionResults('missing-election');

      expect(result).toBeNull();
      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });

    it('returns aggregated results for anonymous elections with participation detail but without selected options', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [mockElection] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'option-1',
              label: 'Alice',
              option_type: 'ticket',
              parent_option_id: null,
              image_url: null,
              metadata: null,
              vote_count: '3',
            },
            {
              id: 'option-2',
              label: 'Bob',
              option_type: 'ticket',
              parent_option_id: null,
              image_url: null,
              metadata: null,
              vote_count: '1',
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ total: '10', voted: '4' }] })
        .mockResolvedValueOnce({
          rows: [
            {
              full_name: 'Ana Perez',
              carnet: '202400001',
              has_voted: true,
              selected_option_label: 'Alice',
            },
            {
              full_name: 'Bruno Mora',
              carnet: '202400002',
              has_voted: false,
              selected_option_label: null,
            },
          ],
        });

      const result = await getElectionResults('election-1');

      expect(result).toEqual({
        election: mockElection,
        options: [
          {
            id: 'option-1',
            label: 'Alice',
            option_type: 'ticket',
            parent_option_id: null,
            image_url: null,
            metadata: null,
            vote_count: 3,
            percentage: 75,
          },
          {
            id: 'option-2',
            label: 'Bob',
            option_type: 'ticket',
            parent_option_id: null,
            image_url: null,
            metadata: null,
            vote_count: 1,
            percentage: 25,
          },
        ],
        total_votes: 4,
        total_eligible: 10,
        participation_rate: 40,
        voters: [
          {
            full_name: 'Ana Perez',
            carnet: '202400001',
            has_voted: true,
            selected_option_label: null,
          },
          {
            full_name: 'Bruno Mora',
            carnet: '202400002',
            has_voted: false,
            selected_option_label: null,
          },
        ],
      });
      expect(mockPool.query).toHaveBeenCalledTimes(4);
    });

    it('includes voter identities, participation, and selected options for public elections', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ ...mockElection, is_anonymous: false }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'option-1',
              label: 'Alice',
              option_type: 'ticket',
              parent_option_id: null,
              image_url: null,
              metadata: null,
              vote_count: '2',
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ total: '5', voted: '2' }] })
        .mockResolvedValueOnce({
          rows: [
            {
              full_name: 'Ana Perez',
              carnet: '202400001',
              has_voted: true,
              selected_option_label: 'Alice',
            },
            {
              full_name: 'Bruno Mora',
              carnet: '202400002',
              has_voted: false,
              selected_option_label: null,
            },
          ],
        });

      const result = await getElectionResults('election-1');

      expect(result).toEqual({
        election: { ...mockElection, is_anonymous: false },
        options: [
          {
            id: 'option-1',
            label: 'Alice',
            option_type: 'ticket',
            parent_option_id: null,
            image_url: null,
            metadata: null,
            vote_count: 2,
            percentage: 100,
          },
        ],
        total_votes: 2,
        total_eligible: 5,
        participation_rate: 40,
        voters: [
          {
            full_name: 'Ana Perez',
            carnet: '202400001',
            has_voted: true,
            selected_option_label: 'Alice',
          },
          {
            full_name: 'Bruno Mora',
            carnet: '202400002',
            has_voted: false,
            selected_option_label: null,
          },
        ],
      });
      expect(mockPool.query).toHaveBeenCalledTimes(4);
      expect(mockPool.query.mock.calls[3]?.[0]).toContain('ev.token_used AS has_voted');
    });
  });

  describe('getVotesByHour', () => {
    it('maps vote rows to ISO timestamps for the frontend', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ hour: new Date('2026-05-01T10:00:00.000Z'), count: 6 }],
      });

      const result = await getVotesByHour('election-1');

      expect(result).toEqual([{ hour: '2026-05-01T10:00:00.000Z', count: 6 }]);
      expect(mockPool.query).toHaveBeenCalledWith(expect.stringContaining("date_trunc('hour', created_at)"), ['election-1']);
    });
  });
});
