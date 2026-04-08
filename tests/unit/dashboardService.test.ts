import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/modules/dashboard/repositories/dashboardRepository', () => ({
  getStats: vi.fn(),
}));

import * as repo from '../../src/modules/dashboard/repositories/dashboardRepository';
import * as dashboardService from '../../src/modules/dashboard/services/dashboardService';

describe('dashboardService.getStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns repository payload', async () => {
    const fakeStats = {
      totalStudents: 100,
      activeStudents: 90,
      totalElections: 6,
      openElections: 2,
      totalVotes: 50,
      participation: 55.6,
      ongoingElections: [],
    };

    vi.mocked(repo.getStats).mockResolvedValue(fakeStats);

    const result = await dashboardService.getStats();

    expect(repo.getStats).toHaveBeenCalledTimes(1);
    expect(result).toEqual(fakeStats);
  });
});
