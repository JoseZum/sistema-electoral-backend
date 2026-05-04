import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/modules/dashboard/repositories/dashboardRepository');

import * as dashboardRepo from '../../../src/modules/dashboard/repositories/dashboardRepository';
import { getStats } from '../../../src/modules/dashboard/services/dashboardService';

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

describe('dashboardService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getStats', () => {
    it('returns the stats produced by the repository', async () => {
      vi.mocked(dashboardRepo.getStats).mockResolvedValue(mockStats);

      const result = await getStats();

      expect(result).toEqual(mockStats);
      expect(dashboardRepo.getStats).toHaveBeenCalledOnce();
    });

    it('propagates repository errors', async () => {
      vi.mocked(dashboardRepo.getStats).mockRejectedValue(new Error('DB error'));

      await expect(getStats()).rejects.toThrow('DB error');
      expect(dashboardRepo.getStats).toHaveBeenCalledOnce();
    });
  });
});
