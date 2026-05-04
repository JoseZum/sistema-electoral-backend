import crypto from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/modules/voting/repositories/votingRepository');
vi.mock('../../../src/modules/elections/repositories/electionRepository');

import * as votingRepo from '../../../src/modules/voting/repositories/votingRepository';
import {
  findElectionById,
  syncAutomaticStatuses,
} from '../../../src/modules/elections/repositories/electionRepository';
import { env } from '../../../src/config/env';
import {
  castVote,
  getElectionForVoting,
  getMyElections,
  getResults,
  prepareAnonymousVotingTokensForElection,
} from '../../../src/modules/voting/services/votingService';

const mockStudent = {
  id: 'student-1',
  carnet: '202400001',
  full_name: 'Ana Perez',
};

const mockElectionListItem = {
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
  total_options: 2,
};

const mockElectionAccess = {
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

const mockOptions = [
  { id: 'option-1', label: 'Alice', option_type: 'ticket', display_order: 1 },
  { id: 'option-2', label: 'Bob', option_type: 'ticket', display_order: 2 },
];

const pendingVoters = [
  { student_id: 'student-1', carnet: '202400001', full_name: 'Ana Perez' },
  { student_id: 'student-2', carnet: '202400002', full_name: 'Luis Mora' },
];

function encryptVoteTokenForTest(token: string, ivHex = '00112233445566778899aabb'): string {
  const key = crypto
    .createHash('sha256')
    .update(`${env.voteTokenSecret}:encrypt`)
    .digest();
  const iv = Buffer.from(ivHex, 'hex');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${ivHex}.${encrypted.toString('hex')}.${tag.toString('hex')}`;
}

function hashVoteTokenForTest(token: string): string {
  return crypto.createHash('sha256').update(`${token}${env.voteTokenSecret}`).digest('hex');
}

describe('votingService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();

    vi.mocked(syncAutomaticStatuses).mockResolvedValue(undefined);
    vi.mocked(votingRepo.findStudentIdentityByEmail).mockResolvedValue(mockStudent);
    vi.mocked(findElectionById).mockResolvedValue({
      id: 'election-1',
      is_anonymous: true,
      status: 'OPEN',
    } as any);
  });

  describe('prepareAnonymousVotingTokensForElection', () => {
    it('returns 0 when election does not exist', async () => {
      vi.mocked(findElectionById).mockResolvedValue(null);

      const result = await prepareAnonymousVotingTokensForElection('missing-election');

      expect(result).toBe(0);
      expect(votingRepo.listPendingAnonymousVoters).not.toHaveBeenCalled();
      expect(votingRepo.insertMissingVotingTokens).not.toHaveBeenCalled();
    });

    it('returns 0 when election is not anonymous or no longer tokenizable', async () => {
      vi.mocked(findElectionById).mockResolvedValue({
        id: 'election-1',
        is_anonymous: false,
        status: 'SCRUTINIZED',
      } as any);

      const result = await prepareAnonymousVotingTokensForElection('election-1');

      expect(result).toBe(0);
      expect(votingRepo.listPendingAnonymousVoters).not.toHaveBeenCalled();
    });

    it('returns 0 when there are no pending voters', async () => {
      vi.mocked(votingRepo.listPendingAnonymousVoters).mockResolvedValue([]);

      const result = await prepareAnonymousVotingTokensForElection('election-1');

      expect(result).toBe(0);
      expect(votingRepo.insertMissingVotingTokens).not.toHaveBeenCalled();
    });

    it('creates encrypted token rows and returns the number of created voters', async () => {
      const randomBytesSpy = vi.spyOn(crypto, 'randomBytes');
      randomBytesSpy
        .mockReturnValueOnce(Buffer.from('11'.repeat(32), 'hex'))
        .mockReturnValueOnce(Buffer.from('aa'.repeat(12), 'hex'))
        .mockReturnValueOnce(Buffer.from('22'.repeat(32), 'hex'))
        .mockReturnValueOnce(Buffer.from('bb'.repeat(12), 'hex'));

      vi.mocked(votingRepo.listPendingAnonymousVoters).mockResolvedValue(pendingVoters);
      vi.mocked(votingRepo.insertMissingVotingTokens).mockResolvedValue(['student-1', 'student-2']);

      const result = await prepareAnonymousVotingTokensForElection('election-1');

      expect(result).toBe(2);
      expect(votingRepo.insertMissingVotingTokens).toHaveBeenCalledOnce();

      const rows = vi.mocked(votingRepo.insertMissingVotingTokens).mock.calls[0]?.[0];
      expect(rows).toHaveLength(2);
      expect(rows?.[0]).toMatchObject({
        election_id: 'election-1',
        student_id: 'student-1',
      });
      expect(rows?.[1]).toMatchObject({
        election_id: 'election-1',
        student_id: 'student-2',
      });
      expect(rows?.[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(rows?.[1]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(rows?.[0]?.token_encrypted.split('.')).toHaveLength(3);
      expect(rows?.[1]?.token_encrypted.split('.')).toHaveLength(3);
    });
  });

  describe('getMyElections', () => {
    it('syncs statuses, resolves student and returns voter elections', async () => {
      vi.mocked(votingRepo.findElectionsForVoter).mockResolvedValue([mockElectionListItem]);

      const result = await getMyElections('ana@estudiantec.cr');

      expect(result).toEqual([mockElectionListItem]);
      expect(syncAutomaticStatuses).toHaveBeenCalledOnce();
      expect(votingRepo.findStudentIdentityByEmail).toHaveBeenCalledWith('ana@estudiantec.cr');
      expect(votingRepo.findElectionsForVoter).toHaveBeenCalledWith('student-1');
    });

    it('throws when the student email is not found in padron', async () => {
      vi.mocked(votingRepo.findStudentIdentityByEmail).mockResolvedValue(null);

      await expect(getMyElections('missing@estudiantec.cr')).rejects.toMatchObject({
        status: 404,
        code: 'VOTING_STUDENT_NOT_FOUND',
      });
    });
  });

  describe('getElectionForVoting', () => {
    it('returns election detail with options and prepares tokens for anonymous elections', async () => {
      vi.mocked(votingRepo.findElectionForVoting).mockResolvedValue(mockElectionAccess);
      vi.mocked(votingRepo.findElectionOptions).mockResolvedValue(mockOptions);
      vi.mocked(votingRepo.listPendingAnonymousVoters).mockResolvedValue([pendingVoters[0]]);
      vi.mocked(votingRepo.insertMissingVotingTokens).mockResolvedValue(['student-1']);

      const result = await getElectionForVoting('election-1', 'ana@estudiantec.cr');

      expect(result).toEqual({ ...mockElectionAccess, options: mockOptions });
      expect(syncAutomaticStatuses).toHaveBeenCalledOnce();
      expect(votingRepo.findElectionForVoting).toHaveBeenCalledWith('election-1', 'student-1');
      expect(votingRepo.listPendingAnonymousVoters).toHaveBeenCalledWith('election-1');
      expect(votingRepo.insertMissingVotingTokens).toHaveBeenCalledOnce();
      expect(votingRepo.findElectionOptions).toHaveBeenCalledWith('election-1');
    });

    it('throws forbidden when the voter has no access to the election', async () => {
      vi.mocked(votingRepo.findElectionForVoting).mockResolvedValue(null);

      await expect(getElectionForVoting('election-1', 'ana@estudiantec.cr')).rejects.toMatchObject({
        status: 403,
        code: 'VOTING_ELECTION_ACCESS_DENIED',
      });
    });

    it('does not prepare anonymous tokens for named elections', async () => {
      vi.mocked(votingRepo.findElectionForVoting).mockResolvedValue({
        ...mockElectionAccess,
        is_anonymous: false,
      });
      vi.mocked(votingRepo.findElectionOptions).mockResolvedValue(mockOptions);

      await getElectionForVoting('election-1', 'ana@estudiantec.cr');

      expect(votingRepo.listPendingAnonymousVoters).not.toHaveBeenCalled();
      expect(votingRepo.insertMissingVotingTokens).not.toHaveBeenCalled();
    });
  });

  describe('castVote', () => {
    it('throws forbidden when the voter has no access to the election', async () => {
      vi.mocked(votingRepo.findElectionForVoting).mockResolvedValue(null);

      await expect(
        castVote({ electionId: 'election-1', optionId: 'option-1' }, 'ana@estudiantec.cr')
      ).rejects.toMatchObject({
        status: 403,
        code: 'VOTING_ELECTION_ACCESS_DENIED',
      });
    });

    it('throws conflict when the election is not open', async () => {
      vi.mocked(votingRepo.findElectionForVoting).mockResolvedValue({
        ...mockElectionAccess,
        status: 'CLOSED',
      });

      await expect(
        castVote({ electionId: 'election-1', optionId: 'option-1' }, 'ana@estudiantec.cr')
      ).rejects.toMatchObject({
        status: 409,
        code: 'VOTING_NOT_OPEN',
      });
    });

    it('throws conflict when the voter already voted', async () => {
      vi.mocked(votingRepo.findElectionForVoting).mockResolvedValue({
        ...mockElectionAccess,
        has_voted: true,
      });

      await expect(
        castVote({ electionId: 'election-1', optionId: 'option-1' }, 'ana@estudiantec.cr')
      ).rejects.toMatchObject({
        status: 409,
        code: 'VOTING_ALREADY_VOTED',
      });
    });

    it('casts an anonymous vote using the hash derived from the encrypted token', async () => {
      const token = 'known-anonymous-token';
      const encryptedToken = encryptVoteTokenForTest(token);
      const expectedHash = hashVoteTokenForTest(token);

      vi.mocked(votingRepo.findElectionForVoting).mockResolvedValue(mockElectionAccess);
      vi.mocked(votingRepo.listPendingAnonymousVoters).mockResolvedValue([]);
      vi.mocked(votingRepo.findVotingTokenByStudent).mockResolvedValue({
        token_encrypted: encryptedToken,
      });
      vi.mocked(votingRepo.castAnonymousVote).mockResolvedValue(undefined);

      const result = await castVote(
        { electionId: 'election-1', optionId: 'option-1' },
        'ana@estudiantec.cr'
      );

      expect(result).toEqual({ success: true, message: 'Voto emitido exitosamente' });
      expect(votingRepo.castAnonymousVote).toHaveBeenCalledWith(
        'election-1',
        'option-1',
        expectedHash
      );
    });

    it('throws not found when an anonymous election has no available token', async () => {
      vi.mocked(votingRepo.findElectionForVoting).mockResolvedValue(mockElectionAccess);
      vi.mocked(votingRepo.listPendingAnonymousVoters).mockResolvedValue([]);
      vi.mocked(votingRepo.findVotingTokenByStudent).mockResolvedValue(null);

      await expect(
        castVote({ electionId: 'election-1', optionId: 'option-1' }, 'ana@estudiantec.cr')
      ).rejects.toMatchObject({
        status: 404,
        code: 'VOTING_TOKEN_NOT_FOUND',
      });
    });

    it('maps invalid or used anonymous token errors to a conflict', async () => {
      const token = 'known-anonymous-token';
      vi.mocked(votingRepo.findElectionForVoting).mockResolvedValue(mockElectionAccess);
      vi.mocked(votingRepo.listPendingAnonymousVoters).mockResolvedValue([]);
      vi.mocked(votingRepo.findVotingTokenByStudent).mockResolvedValue({
        token_encrypted: encryptVoteTokenForTest(token, 'ffeeddccbbaa998877665544'),
      });
      vi.mocked(votingRepo.castAnonymousVote).mockRejectedValue(new Error('token invalido'));

      await expect(
        castVote({ electionId: 'election-1', optionId: 'option-1' }, 'ana@estudiantec.cr')
      ).rejects.toMatchObject({
        status: 409,
        code: 'VOTING_TOKEN_INVALID_OR_USED',
      });
    });

    it('casts a named vote with the resolved student id', async () => {
      vi.mocked(votingRepo.findElectionForVoting).mockResolvedValue({
        ...mockElectionAccess,
        is_anonymous: false,
      });
      vi.mocked(votingRepo.castNamedVote).mockResolvedValue(undefined);

      const result = await castVote(
        { electionId: 'election-1', optionId: 'option-1' },
        'ana@estudiantec.cr'
      );

      expect(result).toEqual({ success: true, message: 'Voto emitido exitosamente' });
      expect(votingRepo.castNamedVote).toHaveBeenCalledWith('election-1', 'option-1', 'student-1');
      expect(votingRepo.findVotingTokenByStudent).not.toHaveBeenCalled();
    });

    it('maps duplicate named vote errors to a conflict', async () => {
      vi.mocked(votingRepo.findElectionForVoting).mockResolvedValue({
        ...mockElectionAccess,
        is_anonymous: false,
      });
      vi.mocked(votingRepo.castNamedVote).mockRejectedValue(new Error('duplicate key value'));

      await expect(
        castVote({ electionId: 'election-1', optionId: 'option-1' }, 'ana@estudiantec.cr')
      ).rejects.toMatchObject({
        status: 409,
        code: 'VOTING_ALREADY_VOTED',
      });
    });
  });

  describe('getResults', () => {
    it('throws forbidden when the voter cannot access the election', async () => {
      vi.mocked(votingRepo.findElectionForVoting).mockResolvedValue(null);

      await expect(getResults('election-1', 'ana@estudiantec.cr')).rejects.toMatchObject({
        status: 403,
        code: 'VOTING_ELECTION_ACCESS_DENIED',
      });
    });

    it('throws conflict when public results are not yet available', async () => {
      vi.mocked(votingRepo.findElectionForVoting).mockResolvedValue(mockElectionAccess);
      vi.mocked(votingRepo.getPublicResults).mockResolvedValue(null);

      await expect(getResults('election-1', 'ana@estudiantec.cr')).rejects.toMatchObject({
        status: 409,
        code: 'VOTING_RESULTS_UNAVAILABLE',
      });
    });

    it('returns percentages and participation rate from public results', async () => {
      vi.mocked(votingRepo.findElectionForVoting).mockResolvedValue(mockElectionAccess);
      vi.mocked(votingRepo.getPublicResults).mockResolvedValue({
        title: 'Student Council 2026',
        options: [
          { label: 'Alice', option_type: 'ticket', vote_count: 15 },
          { label: 'Bob', option_type: 'ticket', vote_count: 9 },
        ],
        total_eligible: 30,
        total_voted: 24,
      });

      const result = await getResults('election-1', 'ana@estudiantec.cr');

      expect(result.election_id).toBe('election-1');
      expect(result.title).toBe('Student Council 2026');
      expect(result.total_votes).toBe(24);
      expect(result.participation_rate).toBeCloseTo(80);
      expect(result.options).toHaveLength(2);
      expect(result.options[0]).toMatchObject({
        label: 'Alice',
        option_type: 'ticket',
        vote_count: 15,
      });
      expect(result.options[0]?.percentage).toBeCloseTo(62.5);
      expect(result.options[1]?.percentage).toBeCloseTo(37.5);
    });

    it('returns zero percentages when no votes have been cast', async () => {
      vi.mocked(votingRepo.findElectionForVoting).mockResolvedValue(mockElectionAccess);
      vi.mocked(votingRepo.getPublicResults).mockResolvedValue({
        title: 'Student Council 2026',
        options: [
          { label: 'Alice', option_type: 'ticket', vote_count: 0 },
          { label: 'Bob', option_type: 'ticket', vote_count: 0 },
        ],
        total_eligible: 0,
        total_voted: 0,
      });

      const result = await getResults('election-1', 'ana@estudiantec.cr');

      expect(result.total_votes).toBe(0);
      expect(result.participation_rate).toBe(0);
      expect(result.options[0]?.percentage).toBe(0);
      expect(result.options[1]?.percentage).toBe(0);
    });
  });
});
