import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextFunction, Request, Response } from 'express';

vi.mock('../../../src/modules/dashboard/services/dashboardService');

import * as dashboardService from '../../../src/modules/dashboard/services/dashboardService';
import { getStats } from '../../../src/modules/dashboard/controllers/dashboardController';

const mockStats = {
  totalStudents: 250,
  activeStudents: 220,
  totalElections: 8,
  openElections: 2,
  totalVotes: 75,
  participation: 62.5,
  ongoingElections: [
    {
      id: 'election-1',
      title: 'Student Council 2026',
      startTime: new Date('2026-05-01T10:00:00.000Z'),
      endTime: new Date('2026-05-02T18:00:00.000Z'),
      votesCount: 45,
      totalVoters: 60,
      progressPercentage: 75,
    },
  ],
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
    query: {},
    body: {},
    headers: {},
    ...overrides,
  } as unknown as Request;
}

function makeNext(): NextFunction {
  return vi.fn() as unknown as NextFunction;
}

describe('dashboardController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getStats', () => {
    it('responds with dashboard stats from the service', async () => {
      vi.mocked(dashboardService.getStats).mockResolvedValue(mockStats);
      const res = makeRes();

      await getStats(makeReq(), res, makeNext());

      expect(dashboardService.getStats).toHaveBeenCalledOnce();
      expect(res.json).toHaveBeenCalledWith(mockStats);
    });

    it('passes service errors to next', async () => {
      vi.mocked(dashboardService.getStats).mockRejectedValue(new Error('DB error'));
      const next = makeNext();

      await getStats(makeReq(), makeRes(), next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});
