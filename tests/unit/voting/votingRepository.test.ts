import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  castAnonymousVote,
  castNamedVote,
  findElectionForVoting,
  findElectionOptions,
  findElectionsForVoter,
  findStudentIdentityByEmail,
  findVotingTokenByStudent,
  getPublicResults,
  insertMissingVotingTokens,
  listPendingAnonymousVoters,
  upsertVotingTokens,
} from '../../../src/modules/voting/repositories/votingRepository';
import { VoteOption, VoterElection } from '../../../src/modules/voting/models/votingModel';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../../src/config/database', () => ({ pool: mockPool }));

const mockElection: VoterElection = {
  id: 'election-1',
  title: 'Student Council 2026',
  description: 'General student election',
  status: 'OPEN',
  is_anonymous: true,
  tag_name: 'Engineering',
  tag_color: '#2563EB',
  start_time: new Date('2026-05-01T10:00:00.000Z'),
  end_time: new Date('2026-05-02T18:00:00.000Z'),
  has_voted: false,
  total_options: 3,
};

const mockElectionDetail = {
  id: 'election-1',
  title: 'Student Council 2026',
  description: 'General student election',
  status: 'OPEN',
  is_anonymous: true,
  tag_name: 'Engineering',
  tag_color: '#2563EB',
  start_time: new Date('2026-05-01T10:00:00.000Z'),
  end_time: new Date('2026-05-02T18:00:00.000Z'),
  has_voted: false,
};

const mockOption: VoteOption = {
  id: 'option-1',
  label: 'Alice',
  option_type: 'ticket',
  display_order: 1,
};

const mockIdentity = {
  id: 'student-1',
  carnet: '202400001',
  full_name: 'Ana Perez',
};

const mockPendingVoter = {
  student_id: 'student-1',
  carnet: '202400001',
  full_name: 'Ana Perez',
};

const tokenRows = [
  {
    election_id: 'election-1',
    student_id: 'student-1',
    token_hash: 'hash-1',
    token_encrypted: 'encrypted-1',
  },
  {
    election_id: 'election-1',
    student_id: 'student-2',
    token_hash: 'hash-2',
    token_encrypted: 'encrypted-2',
  },
];

function makeClient(rows: unknown[], rowCount = rows.length) {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount }) };
}

function assertManualUpsertConflictClause(sql: string): void {
  expect(sql).toContain('ON CONFLICT (election_id, student_id) DO UPDATE');
  expect(sql).toContain('token_hash = EXCLUDED.token_hash');
  expect(sql).toContain('token_encrypted = EXCLUDED.token_encrypted');
  expect(sql).toContain('generated_at = now()');
  expect(sql).toContain('used = false');
  expect(sql).toContain('used_at = NULL');
  expect(sql).toContain('WHERE voting_tokens.used = false');
  expect(sql).not.toContain('DELETE');
}

describe('votingRepository', () => {
  beforeEach(() => {
    mockPool.query.mockReset();
  });

  describe('findElectionsForVoter', () => {
    it('returns elections available to the voter', async () => {
      mockPool.query.mockResolvedValue({ rows: [mockElection] });

      const result = await findElectionsForVoter('student-1');

      expect(result).toEqual([mockElection]);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INNER JOIN election_voters ev'),
        ['student-1']
      );
    });

    it('returns an empty array when the voter has no elections', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await findElectionsForVoter('student-404');

      expect(result).toEqual([]);
    });
  });

  describe('findElectionForVoting', () => {
    it('returns the election detail when the voter belongs to the election', async () => {
      mockPool.query.mockResolvedValue({ rows: [mockElectionDetail] });

      const result = await findElectionForVoting('election-1', 'student-1');

      expect(result).toEqual(mockElectionDetail);
      expect(mockPool.query).toHaveBeenCalledWith(expect.any(String), ['election-1', 'student-1']);
    });

    it('returns null when the voter is not eligible for the election', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await findElectionForVoting('election-1', 'student-404');

      expect(result).toBeNull();
    });
  });

  describe('findElectionOptions', () => {
    it('returns the election options ordered by display_order', async () => {
      mockPool.query.mockResolvedValue({ rows: [mockOption] });

      const result = await findElectionOptions('election-1');

      expect(result).toEqual([mockOption]);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM election_options'),
        ['election-1']
      );
    });

    it('returns an empty array when the election has no options', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await findElectionOptions('election-empty');

      expect(result).toEqual([]);
    });
  });

  describe('findStudentIdentityByEmail', () => {
    it('returns student identity when an active email matches', async () => {
      mockPool.query.mockResolvedValue({ rows: [mockIdentity] });

      const result = await findStudentIdentityByEmail('ana@estudiantec.cr');

      expect(result).toEqual(mockIdentity);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM students'),
        ['ana@estudiantec.cr']
      );
    });

    it('returns null when no active student matches the email', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await findStudentIdentityByEmail('missing@estudiantec.cr');

      expect(result).toBeNull();
    });
  });

  describe('listPendingAnonymousVoters', () => {
    it('returns pending voters using pool by default', async () => {
      mockPool.query.mockResolvedValue({ rows: [mockPendingVoter] });

      const result = await listPendingAnonymousVoters('election-1');

      expect(result).toEqual([mockPendingVoter]);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('AND ev.token_used = false'),
        ['election-1']
      );
    });

    it('uses the provided client when one is passed', async () => {
      const client = makeClient([mockPendingVoter]);

      const result = await listPendingAnonymousVoters('election-1', client as any);

      expect(result).toEqual([mockPendingVoter]);
      expect(client.query).toHaveBeenCalledOnce();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('insertMissingVotingTokens', () => {
    it('returns an empty array without querying when no rows are provided', async () => {
      const client = makeClient([]);

      const result = await insertMissingVotingTokens([], client as any);

      expect(result).toEqual([]);
      expect(client.query).not.toHaveBeenCalled();
    });

    it('inserts token rows and returns the inserted student ids', async () => {
      const client = makeClient([{ student_id: 'student-1' }, { student_id: 'student-2' }]);

      const result = await insertMissingVotingTokens(tokenRows, client as any);

      expect(result).toEqual(['student-1', 'student-2']);
      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO voting_tokens'),
        [
          ['election-1', 'election-1'],
          ['student-1', 'student-2'],
          ['hash-1', 'hash-2'],
          ['encrypted-1', 'encrypted-2'],
        ]
      );
    });
  });

  describe('upsertVotingTokens', () => {
    it('returns an empty array without querying when no rows are provided', async () => {
      const client = makeClient([]);

      const result = await upsertVotingTokens([], client as any);

      expect(result).toEqual([]);
      expect(client.query).not.toHaveBeenCalled();
    });

    it('upserts token rows and returns affected student ids', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ student_id: 'student-1' }] });

      const result = await upsertVotingTokens(tokenRows);

      expect(result).toEqual(['student-1']);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT (election_id, student_id) DO UPDATE'),
        [
          ['election-1', 'election-1'],
          ['student-1', 'student-2'],
          ['hash-1', 'hash-2'],
          ['encrypted-1', 'encrypted-2'],
        ]
      );
    });

    it('validates the exact reusable-token conflict clause', async () => {
      const client = makeClient([{ student_id: 'student-1' }]);

      await upsertVotingTokens(tokenRows, client as any);

      const sql = (client.query.mock.calls[0] as [string])[0];
      assertManualUpsertConflictClause(sql);
    });
  });

  describe('findVotingTokenByStudent', () => {
    it('returns the encrypted token when one is available', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ token_encrypted: 'encrypted-1' }] });

      const result = await findVotingTokenByStudent('election-1', 'student-1');

      expect(result).toEqual({ token_encrypted: 'encrypted-1' });
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('AND used = false'),
        ['election-1', 'student-1']
      );
    });

    it('returns null when there is no unused token for the student', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await findVotingTokenByStudent('election-1', 'student-404');

      expect(result).toBeNull();
    });
  });

  describe('castAnonymousVote', () => {
    it('calls the anonymous voting function in the database', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await castAnonymousVote('election-1', 'option-1', 'hash-1');

      expect(mockPool.query).toHaveBeenCalledWith(
        'SELECT fn_cast_vote_anonymous($1, $2, $3)',
        ['election-1', 'option-1', 'hash-1']
      );
    });
  });

  describe('castNamedVote', () => {
    it('calls the named voting function in the database', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await castNamedVote('election-1', 'option-1', 'student-1');

      expect(mockPool.query).toHaveBeenCalledWith(
        'SELECT fn_cast_vote_named($1, $2, $3)',
        ['election-1', 'option-1', 'student-1']
      );
    });
  });

  describe('getPublicResults', () => {
    it('returns null when the election does not exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await getPublicResults('missing-election');

      expect(result).toBeNull();
      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });

    it('returns null when the election is not yet public', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ title: 'Draft Election', status: 'OPEN' }] });

      const result = await getPublicResults('election-1');

      expect(result).toBeNull();
      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });

    it('returns parsed public results for closed elections', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ title: 'Student Council 2026', status: 'SCRUTINIZED' }] })
        .mockResolvedValueOnce({
          rows: [
            { label: 'Alice', option_type: 'ticket', vote_count: '15' },
            { label: 'Bob', option_type: 'ticket', vote_count: '9' },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ total: '30', voted: '24' }] });

      const result = await getPublicResults('election-1');

      expect(result).toEqual({
        title: 'Student Council 2026',
        options: [
          { label: 'Alice', option_type: 'ticket', vote_count: 15 },
          { label: 'Bob', option_type: 'ticket', vote_count: 9 },
        ],
        total_eligible: 30,
        total_voted: 24,
      });
      expect(mockPool.query).toHaveBeenCalledTimes(3);
      expect(mockPool.query.mock.calls[1]?.[0]).toContain('LEFT JOIN votes v');
      expect(mockPool.query.mock.calls[2]?.[0]).toContain('COUNT(*) FILTER');
    });
  });
});
