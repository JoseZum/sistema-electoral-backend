import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextFunction, Request, Response } from 'express';

vi.mock('../../../src/modules/scrutiny/services/scrutinyService');

import * as scrutinyService from '../../../src/modules/scrutiny/services/scrutinyService';
import {
  assingMembersElection,
  finalizedElection,
  operativeStatusElection,
  resultsScrutiny,
  submitKey,
} from '../../../src/modules/scrutiny/controllers/scrutinyController';

const mockOperativeState = {
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
    membersPending: [
      {
        id: 'student-1',
        full_name: 'Ana Perez',
        carnet: '202400001',
        has_submitted: false,
      },
    ],
    can_finalize: false,
  },
  general_Metric: {
    total_votes: 24,
    total_elegibles: 30,
    participation_rate: 80,
  },
  publication_status: 'results_available',
};

const mockAssignedMembers = {
  result: true,
  keys: ['123456', '987654'],
};

const mockSubmitResult = {
  submitted: true,
  finalized: false,
};

const mockScrutinyResults = {
  id: 'election-1',
  title: 'Student Council 2026',
  total_votes: 24,
  total_elegibles: 30,
  participation_rate: 80,
  options: [
    { id: 'option-1', label: 'Alice', option_type: 'ticket', vote_count: 15, percentage: 62.5 },
    { id: 'option-2', label: 'Bob', option_type: 'ticket', vote_count: 9, percentage: 37.5 },
  ],
};

const mockFinalizedElection = {
  id: 'election-1',
  title: 'Student Council 2026',
  status: 'SCRUTINIZED',
};

function makeRes(): Response {
  const res = {} as any;
  res.json = vi.fn().mockReturnValue(res);
  res.status = vi.fn().mockReturnValue(res);
  return res as Response;
}

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    params: {},
    body: {},
    headers: {},
    user: undefined,
    ...overrides,
  } as unknown as Request;
}

function makeNext(): NextFunction {
  return vi.fn() as unknown as NextFunction;
}

describe('scrutinyController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('operativeStatusElection', () => {
    it('responds with the operative scrutiny state as JSON', async () => {
      vi.mocked(scrutinyService.getOperativeStateElection).mockResolvedValue(mockOperativeState as any);
      const res = makeRes();

      await operativeStatusElection(
        makeReq({ params: { electionId: 'election-1' } }),
        res,
        makeNext()
      );

      expect(scrutinyService.getOperativeStateElection).toHaveBeenCalledWith('election-1');
      expect(res.json).toHaveBeenCalledWith(mockOperativeState);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('calls next when the service throws', async () => {
      const error = new Error('scrutiny failed');
      vi.mocked(scrutinyService.getOperativeStateElection).mockRejectedValue(error);
      const next = makeNext();

      await operativeStatusElection(
        makeReq({ params: { electionId: 'election-1' } }),
        makeRes(),
        next
      );

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('assingMembersElection', () => {
    it('responds with 201 and the generated scrutiny keys', async () => {
      vi.mocked(scrutinyService.addMembersElection).mockResolvedValue(mockAssignedMembers as any);
      const res = makeRes();
      const body = { option: '0', students_id: ['student-1', 'student-2'] };

      await assingMembersElection(
        makeReq({
          params: { electionId: 'election-1' },
          body,
          user: { studentId: 'admin-1' } as any,
        }),
        res,
        makeNext()
      );

      expect(scrutinyService.addMembersElection).toHaveBeenCalledWith(
        'election-1',
        body,
        'admin-1'
      );
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(mockAssignedMembers);
    });

    it('passes undefined actor when req.user is missing', async () => {
      vi.mocked(scrutinyService.addMembersElection).mockResolvedValue(mockAssignedMembers as any);

      await assingMembersElection(
        makeReq({
          params: { electionId: 'election-1' },
          body: { option: '1', students_id: ['student-1'] },
        }),
        makeRes(),
        makeNext()
      );

      expect(scrutinyService.addMembersElection).toHaveBeenCalledWith(
        'election-1',
        { option: '1', students_id: ['student-1'] },
        undefined
      );
    });

    it('calls next when the service throws', async () => {
      const error = new Error('duplicate students');
      vi.mocked(scrutinyService.addMembersElection).mockRejectedValue(error);
      const next = makeNext();

      await assingMembersElection(
        makeReq({ params: { electionId: 'election-1' }, body: { option: '0', students_id: [] } }),
        makeRes(),
        next
      );

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('submitKey', () => {
    it('uses req.user.studentId as member_id when available', async () => {
      vi.mocked(scrutinyService.submitKey).mockResolvedValue(mockSubmitResult as any);
      const res = makeRes();

      await submitKey(
        makeReq({
          params: { electionId: 'election-1' },
          body: { key: 'plain-key', memberId: 'ignored-member' },
          user: { studentId: 'student-1' } as any,
        }),
        res,
        makeNext()
      );

      expect(scrutinyService.submitKey).toHaveBeenCalledWith({
        election_id: 'election-1',
        member_id: 'student-1',
        key_shard: 'plain-key',
      });
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(mockSubmitResult);
    });

    it('falls back to req.body.memberId when req.user.studentId is missing', async () => {
      vi.mocked(scrutinyService.submitKey).mockResolvedValue(mockSubmitResult as any);

      await submitKey(
        makeReq({
          params: { electionId: 'election-1' },
          body: { key: 'plain-key', memberId: 'student-2' },
        }),
        makeRes(),
        makeNext()
      );

      expect(scrutinyService.submitKey).toHaveBeenCalledWith({
        election_id: 'election-1',
        member_id: 'student-2',
        key_shard: 'plain-key',
      });
    });

    it('calls next when the service throws', async () => {
      const error = new Error('invalid key');
      vi.mocked(scrutinyService.submitKey).mockRejectedValue(error);
      const next = makeNext();

      await submitKey(
        makeReq({
          params: { electionId: 'election-1' },
          body: { key: 'bad-key', memberId: 'student-1' },
        }),
        makeRes(),
        next
      );

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('resultsScrutiny', () => {
    it('responds with 201 and the scrutiny results', async () => {
      vi.mocked(scrutinyService.scrutinyResult).mockResolvedValue(mockScrutinyResults as any);
      const res = makeRes();

      await resultsScrutiny(
        makeReq({ params: { electionId: 'election-1' } }),
        res,
        makeNext()
      );

      expect(scrutinyService.scrutinyResult).toHaveBeenCalledWith('election-1');
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(mockScrutinyResults);
    });

    it('calls next when the service throws', async () => {
      const error = new Error('results unavailable');
      vi.mocked(scrutinyService.scrutinyResult).mockRejectedValue(error);
      const next = makeNext();

      await resultsScrutiny(
        makeReq({ params: { electionId: 'election-1' } }),
        makeRes(),
        next
      );

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('finalizedElection', () => {
    it('responds with 201 and the finalized election', async () => {
      vi.mocked(scrutinyService.finaleElection).mockResolvedValue(mockFinalizedElection as any);
      const res = makeRes();

      await finalizedElection(
        makeReq({
          params: { electionId: 'election-1' },
          user: { studentId: 'admin-1' } as any,
        }),
        res,
        makeNext()
      );

      expect(scrutinyService.finaleElection).toHaveBeenCalledWith('election-1', 'admin-1');
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(mockFinalizedElection);
    });

    it('passes undefined actor when req.user is missing', async () => {
      vi.mocked(scrutinyService.finaleElection).mockResolvedValue(mockFinalizedElection as any);

      await finalizedElection(
        makeReq({ params: { electionId: 'election-1' } }),
        makeRes(),
        makeNext()
      );

      expect(scrutinyService.finaleElection).toHaveBeenCalledWith('election-1', undefined);
    });

    it('calls next when the service throws', async () => {
      const error = new Error('cannot finalize');
      vi.mocked(scrutinyService.finaleElection).mockRejectedValue(error);
      const next = makeNext();

      await finalizedElection(
        makeReq({ params: { electionId: 'election-1' } }),
        makeRes(),
        next
      );

      expect(next).toHaveBeenCalledWith(error);
    });
  });
});
