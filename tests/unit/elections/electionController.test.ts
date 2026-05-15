import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextFunction, Request, Response } from 'express';

vi.mock('../../../src/modules/elections/services/electionService');

import * as electionService from '../../../src/modules/elections/services/electionService';
import {
  addOption,
  changeStatus,
  clearVoters,
  createElection,
  deleteElection,
  deleteOption,
  getElectionById,
  getElections,
  getMonitoringData,
  getResults,
  populateVoters,
  updateElection,
  updateOption,
} from '../../../src/modules/elections/controllers/electionController';
import { ElectionOption, ElectionWithStats } from '../../../src/modules/elections/models/electionModel';

const mockElection: ElectionWithStats = {
  id: 'election-1',
  title: 'Student Council 2026',
  description: 'General election',
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
  requires_keys: false,
  min_keys: 1,
  start_time: new Date('2026-05-01T10:00:00.000Z'),
  end_time: new Date('2026-05-02T18:00:00.000Z'),
  created_by: 'admin-1',
  created_at: new Date('2026-04-20T10:00:00.000Z'),
  updated_at: new Date('2026-04-25T10:00:00.000Z'),
  total_voters: 120,
  votes_cast: 84,
  options_count: 2,
};

const mockOption: ElectionOption = {
  id: 'option-1',
  election_id: 'election-1',
  parent_option_id: null,
  label: 'Alice',
  option_type: 'ticket',
  image_url: null,
  display_order: 1,
  metadata: null,
};

const mockResults = {
  election: mockElection,
  options: [
    {
      id: 'option-1',
      label: 'Alice',
      option_type: 'ticket',
      parent_option_id: null,
      image_url: null,
      metadata: null,
      vote_count: 18,
      percentage: 60,
    },
  ],
  total_votes: 18,
  total_eligible: 30,
  participation_rate: 60,
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
    ip: undefined,
    socket: { remoteAddress: undefined },
    ...overrides,
  } as unknown as Request;
}

function makeNext(): NextFunction {
  return vi.fn() as unknown as NextFunction;
}

describe('electionController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getElections', () => {
    it('responds with all elections from the service', async () => {
      vi.mocked(electionService.getAllElections).mockResolvedValue([mockElection]);
      const res = makeRes();

      await getElections(makeReq(), res, makeNext());

      expect(electionService.getAllElections).toHaveBeenCalledOnce();
      expect(res.json).toHaveBeenCalledWith([mockElection]);
    });

    it('passes service errors to next', async () => {
      const error = new Error('DB error');
      vi.mocked(electionService.getAllElections).mockRejectedValue(error);
      const next = makeNext();

      await getElections(makeReq(), makeRes(), next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('getElectionById', () => {
    it('responds with the election detail', async () => {
      vi.mocked(electionService.getElectionById).mockResolvedValue({
        ...mockElection,
        options: [mockOption],
      } as any);
      const res = makeRes();

      await getElectionById(makeReq({ params: { id: 'election-1' } }), res, makeNext());

      expect(electionService.getElectionById).toHaveBeenCalledWith('election-1');
      expect(res.json).toHaveBeenCalledWith({ ...mockElection, options: [mockOption] });
    });

    it('passes service errors to next', async () => {
      vi.mocked(electionService.getElectionById).mockRejectedValue(new Error('Election not found'));
      const next = makeNext();

      await getElectionById(makeReq({ params: { id: 'missing-election' } }), makeRes(), next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('createElection', () => {
    it('responds with 201 and forwards body plus actor built from req.user and req.ip', async () => {
      vi.mocked(electionService.createElection).mockResolvedValue(mockElection);
      const req = makeReq({
        body: { title: 'Student Council 2026' },
        user: { studentId: 'admin-1', carnet: '202400001' } as any,
        ip: '10.0.0.1',
      });
      const res = makeRes();

      await createElection(req, res, makeNext());

      expect(electionService.createElection).toHaveBeenCalledWith(
        { title: 'Student Council 2026' },
        { id: 'admin-1', carnet: '202400001', ip: '10.0.0.1' }
      );
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(mockElection);
    });

    it('passes service errors to next', async () => {
      vi.mocked(electionService.createElection).mockRejectedValue(new Error('Validation error'));
      const next = makeNext();

      await createElection(makeReq(), makeRes(), next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('updateElection', () => {
    it('forwards id, body, and x-forwarded-for actor data to the service', async () => {
      vi.mocked(electionService.updateElection).mockResolvedValue(mockElection);
      const req = makeReq({
        params: { id: 'election-1' },
        body: { title: 'Updated election' },
        user: { studentId: 'admin-2', carnet: '202400002' } as any,
        headers: { 'x-forwarded-for': '192.168.1.20, 10.0.0.1' },
      });
      const res = makeRes();

      await updateElection(req, res, makeNext());

      expect(electionService.updateElection).toHaveBeenCalledWith(
        'election-1',
        { title: 'Updated election' },
        {
          id: 'admin-2',
          carnet: '202400002',
          ip: '192.168.1.20, 10.0.0.1',
        }
      );
      expect(res.json).toHaveBeenCalledWith(mockElection);
    });

    it('passes service errors to next', async () => {
      vi.mocked(electionService.updateElection).mockRejectedValue(new Error('Update failed'));
      const next = makeNext();

      await updateElection(makeReq({ params: { id: 'election-1' } }), makeRes(), next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('deleteElection', () => {
    it('forwards the id and falls back to socket remoteAddress for actor ip', async () => {
      vi.mocked(electionService.deleteElection).mockResolvedValue({ success: true });
      const req = makeReq({
        params: { id: 'election-1' },
        user: { studentId: 'admin-3', carnet: '202400003' } as any,
        socket: { remoteAddress: '127.0.0.1' } as any,
      });
      const res = makeRes();

      await deleteElection(req, res, makeNext());

      expect(electionService.deleteElection).toHaveBeenCalledWith('election-1', {
        id: 'admin-3',
        carnet: '202400003',
        ip: '127.0.0.1',
      });
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });

    it('passes service errors to next', async () => {
      vi.mocked(electionService.deleteElection).mockRejectedValue(new Error('Delete failed'));
      const next = makeNext();

      await deleteElection(makeReq({ params: { id: 'election-1' } }), makeRes(), next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('changeStatus', () => {
    it('forwards the target status and actor data to the service', async () => {
      vi.mocked(electionService.changeStatus).mockResolvedValue({
        ...mockElection,
        status: 'CLOSED',
      });
      const req = makeReq({
        params: { id: 'election-1' },
        body: { status: 'CLOSED' },
        user: { studentId: 'admin-4', carnet: '202400004' } as any,
        ip: '10.0.0.9',
      });
      const res = makeRes();

      await changeStatus(req, res, makeNext());

      expect(electionService.changeStatus).toHaveBeenCalledWith('election-1', 'CLOSED', {
        id: 'admin-4',
        carnet: '202400004',
        ip: '10.0.0.9',
      });
      expect(res.json).toHaveBeenCalledWith({ ...mockElection, status: 'CLOSED' });
    });

    it('passes service errors to next', async () => {
      vi.mocked(electionService.changeStatus).mockRejectedValue(new Error('Transition failed'));
      const next = makeNext();

      await changeStatus(makeReq({ params: { id: 'election-1' } }), makeRes(), next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('addOption', () => {
    it('responds with 201 and the created option', async () => {
      vi.mocked(electionService.addOption).mockResolvedValue(mockOption);
      const req = makeReq({
        params: { id: 'election-1' },
        body: { label: 'Alice', option_type: 'ticket' },
      });
      const res = makeRes();

      await addOption(req, res, makeNext());

      expect(electionService.addOption).toHaveBeenCalledWith('election-1', {
        label: 'Alice',
        option_type: 'ticket',
      });
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(mockOption);
    });

    it('passes service errors to next', async () => {
      vi.mocked(electionService.addOption).mockRejectedValue(new Error('Add option failed'));
      const next = makeNext();

      await addOption(makeReq({ params: { id: 'election-1' } }), makeRes(), next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('updateOption', () => {
    it('forwards election id, option id, body, and actor to the service', async () => {
      vi.mocked(electionService.updateOption).mockResolvedValue(mockOption);
      const req = makeReq({
        params: { id: 'election-1', optionId: 'option-1' },
        body: { description: 'Updated description' },
        user: { studentId: 'admin-5', carnet: '202400005' } as any,
        ip: '10.0.0.10',
      });
      const res = makeRes();

      await updateOption(req, res, makeNext());

      expect(electionService.updateOption).toHaveBeenCalledWith(
        'election-1',
        'option-1',
        { description: 'Updated description' },
        { id: 'admin-5', carnet: '202400005', ip: '10.0.0.10' }
      );
      expect(res.json).toHaveBeenCalledWith(mockOption);
    });

    it('passes service errors to next', async () => {
      vi.mocked(electionService.updateOption).mockRejectedValue(new Error('Update option failed'));
      const next = makeNext();

      await updateOption(
        makeReq({ params: { id: 'election-1', optionId: 'option-1' } }),
        makeRes(),
        next
      );

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('deleteOption', () => {
    it('forwards both ids and responds with the service result', async () => {
      vi.mocked(electionService.deleteOption).mockResolvedValue({ success: true });
      const res = makeRes();

      await deleteOption(
        makeReq({ params: { id: 'election-1', optionId: 'option-1' } }),
        res,
        makeNext()
      );

      expect(electionService.deleteOption).toHaveBeenCalledWith('election-1', 'option-1');
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });

    it('passes service errors to next', async () => {
      vi.mocked(electionService.deleteOption).mockRejectedValue(new Error('Delete option failed'));
      const next = makeNext();

      await deleteOption(
        makeReq({ params: { id: 'election-1', optionId: 'option-1' } }),
        makeRes(),
        next
      );

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('populateVoters', () => {
    it('forwards election id and body to the service', async () => {
      vi.mocked(electionService.populateVoters).mockResolvedValue({ added: 3, total: 12 });
      const req = makeReq({
        params: { id: 'election-1' },
        body: { tag_id: 'tag-1' },
      });
      const res = makeRes();

      await populateVoters(req, res, makeNext());

      expect(electionService.populateVoters).toHaveBeenCalledWith('election-1', { tag_id: 'tag-1' });
      expect(res.json).toHaveBeenCalledWith({ added: 3, total: 12 });
    });

    it('passes service errors to next', async () => {
      vi.mocked(electionService.populateVoters).mockRejectedValue(new Error('Populate failed'));
      const next = makeNext();

      await populateVoters(makeReq({ params: { id: 'election-1' } }), makeRes(), next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('clearVoters', () => {
    it('forwards the election id and responds with the service result', async () => {
      vi.mocked(electionService.clearVoters).mockResolvedValue({ success: true });
      const res = makeRes();

      await clearVoters(makeReq({ params: { id: 'election-1' } }), res, makeNext());

      expect(electionService.clearVoters).toHaveBeenCalledWith('election-1');
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });

    it('passes service errors to next', async () => {
      vi.mocked(electionService.clearVoters).mockRejectedValue(new Error('Clear failed'));
      const next = makeNext();

      await clearVoters(makeReq({ params: { id: 'election-1' } }), makeRes(), next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('getResults', () => {
    it('responds with election results from the service', async () => {
      vi.mocked(electionService.getResults).mockResolvedValue(mockResults);
      const res = makeRes();

      await getResults(makeReq({ params: { id: 'election-1' } }), res, makeNext());

      expect(electionService.getResults).toHaveBeenCalledWith('election-1');
      expect(res.json).toHaveBeenCalledWith(mockResults);
    });

    it('passes service errors to next', async () => {
      vi.mocked(electionService.getResults).mockRejectedValue(new Error('Results failed'));
      const next = makeNext();

      await getResults(makeReq({ params: { id: 'election-1' } }), makeRes(), next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('getMonitoringData', () => {
    it('responds with monitoring data from the service', async () => {
      vi.mocked(electionService.getMonitoringData).mockResolvedValue({
        votesByHour: [{ hour: '2026-05-01T10:00:00.000Z', count: 5 }],
      });
      const res = makeRes();

      await getMonitoringData(makeReq({ params: { id: 'election-1' } }), res, makeNext());

      expect(electionService.getMonitoringData).toHaveBeenCalledWith('election-1');
      expect(res.json).toHaveBeenCalledWith({
        votesByHour: [{ hour: '2026-05-01T10:00:00.000Z', count: 5 }],
      });
    });

    it('passes service errors to next', async () => {
      vi.mocked(electionService.getMonitoringData).mockRejectedValue(new Error('Monitoring failed'));
      const next = makeNext();

      await getMonitoringData(makeReq({ params: { id: 'election-1' } }), makeRes(), next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});
