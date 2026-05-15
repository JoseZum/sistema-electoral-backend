import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextFunction, Request, Response } from 'express';

vi.mock('../../../src/modules/voting/services/votingService');

import * as votingService from '../../../src/modules/voting/services/votingService';
import {
  castVote,
  getElectionDetail,
  getMyElections,
  getResults,
} from '../../../src/modules/voting/controllers/votingController';

const mockElection = {
  id: 'election-1',
  title: 'Student Council 2026',
  description: 'General student election',
  status: 'OPEN',
  is_anonymous: true,
  allow_suboptions: false,
  tag_name: 'Engineering',
  tag_color: '#2563EB',
  start_time: new Date('2026-05-01T10:00:00.000Z'),
  end_time: new Date('2026-05-02T18:00:00.000Z'),
  has_voted: false,
  total_options: 2,
};

const mockElectionDetail = {
  ...mockElection,
  options: [
    {
      id: 'option-1',
      election_id: 'election-1',
      parent_option_id: null,
      label: 'Alice',
      option_type: 'ticket',
      image_url: null,
      display_order: 1,
      metadata: null,
    },
    {
      id: 'option-2',
      election_id: 'election-1',
      parent_option_id: null,
      label: 'Bob',
      option_type: 'ticket',
      image_url: null,
      display_order: 2,
      metadata: null,
    },
  ],
};

const mockResults = {
  election_id: 'election-1',
  title: 'Student Council 2026',
  options: [
    { label: 'Alice', option_type: 'ticket', vote_count: 15, percentage: 62.5 },
    { label: 'Bob', option_type: 'ticket', vote_count: 9, percentage: 37.5 },
  ],
  total_votes: 24,
  participation_rate: 80,
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

describe('votingController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getMyElections', () => {
    it('responds with voter elections as JSON', async () => {
      vi.mocked(votingService.getMyElections).mockResolvedValue([mockElection]);
      const res = makeRes();

      await getMyElections(
        makeReq({ user: { email: 'ana@estudiantec.cr' } as any }),
        res,
        makeNext()
      );

      expect(votingService.getMyElections).toHaveBeenCalledWith('ana@estudiantec.cr');
      expect(res.json).toHaveBeenCalledWith([mockElection]);
    });

    it('responds 401 when the user email is missing', async () => {
      const res = makeRes();
      const next = makeNext();

      await getMyElections(makeReq(), res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'No autenticado' });
      expect(votingService.getMyElections).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it('calls next when the service throws', async () => {
      const error = new Error('DB error');
      vi.mocked(votingService.getMyElections).mockRejectedValue(error);
      const next = makeNext();

      await getMyElections(
        makeReq({ user: { email: 'ana@estudiantec.cr' } as any }),
        makeRes(),
        next
      );

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('getElectionDetail', () => {
    it('responds with election detail as JSON', async () => {
      vi.mocked(votingService.getElectionForVoting).mockResolvedValue(mockElectionDetail);
      const res = makeRes();

      await getElectionDetail(
        makeReq({ params: { id: 'election-1' }, user: { email: 'ana@estudiantec.cr' } as any }),
        res,
        makeNext()
      );

      expect(votingService.getElectionForVoting).toHaveBeenCalledWith(
        'election-1',
        'ana@estudiantec.cr'
      );
      expect(res.json).toHaveBeenCalledWith(mockElectionDetail);
    });

    it('responds 401 when the user email is missing', async () => {
      const res = makeRes();

      await getElectionDetail(makeReq({ params: { id: 'election-1' } }), res, makeNext());

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'No autenticado' });
      expect(votingService.getElectionForVoting).not.toHaveBeenCalled();
    });

    it('calls next when the service throws', async () => {
      const error = new Error('No tiene acceso');
      vi.mocked(votingService.getElectionForVoting).mockRejectedValue(error);
      const next = makeNext();

      await getElectionDetail(
        makeReq({ params: { id: 'election-1' }, user: { email: 'ana@estudiantec.cr' } as any }),
        makeRes(),
        next
      );

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('castVote', () => {
    it('responds with the service result as JSON', async () => {
      vi.mocked(votingService.castVote).mockResolvedValue({
        success: true,
        message: 'Voto emitido exitosamente',
      });
      const res = makeRes();

      await castVote(
        makeReq({
          body: { electionId: 'election-1', optionId: 'option-1', ignored: 'value' },
          user: { email: 'ana@estudiantec.cr' } as any,
        }),
        res,
        makeNext()
      );

      expect(votingService.castVote).toHaveBeenCalledWith(
        { electionId: 'election-1', optionId: 'option-1' },
        'ana@estudiantec.cr'
      );
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Voto emitido exitosamente',
      });
    });

    it('forwards suboption selections to the voting service', async () => {
      vi.mocked(votingService.castVote).mockResolvedValue({
        success: true,
        message: 'Voto emitido exitosamente',
      });
      const selections = [
        { parentOptionId: 'position-1', optionId: 'candidate-1' },
        { parentOptionId: 'position-2', optionId: 'candidate-3' },
      ];
      const res = makeRes();

      await castVote(
        makeReq({
          body: { electionId: 'election-1', selections, ignored: 'value' },
          user: { email: 'ana@estudiantec.cr' } as any,
        }),
        res,
        makeNext()
      );

      expect(votingService.castVote).toHaveBeenCalledWith(
        { electionId: 'election-1', optionId: undefined, selections },
        'ana@estudiantec.cr'
      );
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Voto emitido exitosamente',
      });
    });

    it('responds 401 when the user email is missing', async () => {
      const res = makeRes();

      await castVote(makeReq({ body: { electionId: 'election-1', optionId: 'option-1' } }), res, makeNext());

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'No autenticado' });
      expect(votingService.castVote).not.toHaveBeenCalled();
    });

    it('calls next when the service throws', async () => {
      const error = new Error('Ya ha votado');
      vi.mocked(votingService.castVote).mockRejectedValue(error);
      const next = makeNext();

      await castVote(
        makeReq({
          body: { electionId: 'election-1', optionId: 'option-1' },
          user: { email: 'ana@estudiantec.cr' } as any,
        }),
        makeRes(),
        next
      );

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('getResults', () => {
    it('responds with election results as JSON', async () => {
      vi.mocked(votingService.getResults).mockResolvedValue(mockResults);
      const res = makeRes();

      await getResults(
        makeReq({ params: { id: 'election-1' }, user: { email: 'ana@estudiantec.cr' } as any }),
        res,
        makeNext()
      );

      expect(votingService.getResults).toHaveBeenCalledWith('election-1', 'ana@estudiantec.cr');
      expect(res.json).toHaveBeenCalledWith(mockResults);
    });

    it('responds 401 when the user email is missing', async () => {
      const res = makeRes();

      await getResults(makeReq({ params: { id: 'election-1' } }), res, makeNext());

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'No autenticado' });
      expect(votingService.getResults).not.toHaveBeenCalled();
    });

    it('calls next when the service throws', async () => {
      const error = new Error('Resultados no disponibles');
      vi.mocked(votingService.getResults).mockRejectedValue(error);
      const next = makeNext();

      await getResults(
        makeReq({ params: { id: 'election-1' }, user: { email: 'ana@estudiantec.cr' } as any }),
        makeRes(),
        next
      );

      expect(next).toHaveBeenCalledWith(error);
    });
  });
});
