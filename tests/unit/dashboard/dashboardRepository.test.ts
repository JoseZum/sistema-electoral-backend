import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPool = vi.hoisted(() => ({
  connect: vi.fn(),
}));

vi.mock('../../../src/config/database', () => ({
  pool: mockPool,
}));

import { getStats } from '../../../src/modules/dashboard/repositories/dashboardRepository';

function makeClient() {
  return {
    query: vi.fn(),
    release: vi.fn(),
  };
}

describe('dashboardRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getStats', () => {
    it('returns parsed dashboard stats and maps ongoing elections', async () => {
      const client = makeClient();
      client.query
        .mockResolvedValueOnce({ rows: [{ count: '250' }] })
        .mockResolvedValueOnce({ rows: [{ count: '220' }] })
        .mockResolvedValueOnce({ rows: [{ count: '8' }] })
        .mockResolvedValueOnce({ rows: [{ count: '2' }] })
        .mockResolvedValueOnce({ rows: [{ total: '75' }] })
        .mockResolvedValueOnce({ rows: [{ total: '120' }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'election-1',
              title: 'Student Council 2026',
              start_time: new Date('2026-05-01T10:00:00.000Z'),
              end_time: new Date('2026-05-02T18:00:00.000Z'),
              votes_cast: '45',
              total_voters: '60',
              progress_percentage: '75.0',
            },
            {
              id: 'election-2',
              title: 'Faculty Board 2026',
              start_time: new Date('2026-05-03T08:00:00.000Z'),
              end_time: new Date('2026-05-03T16:00:00.000Z'),
              votes_cast: '30',
              total_voters: '60',
              progress_percentage: '50.0',
            },
          ],
        });

      vi.mocked(mockPool.connect).mockResolvedValue(client as any);

      const result = await getStats();

      expect(result).toEqual({
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
          {
            id: 'election-2',
            title: 'Faculty Board 2026',
            startTime: new Date('2026-05-03T08:00:00.000Z'),
            endTime: new Date('2026-05-03T16:00:00.000Z'),
            votesCount: 30,
            totalVoters: 60,
            progressPercentage: 50,
          },
        ],
      });

      expect(mockPool.connect).toHaveBeenCalledOnce();
      expect(client.query).toHaveBeenCalledTimes(7);
      expect(client.query).toHaveBeenNthCalledWith(1, 'SELECT COUNT(*) FROM students');
      expect(client.query).toHaveBeenNthCalledWith(2, 'SELECT COUNT(*) FROM students WHERE is_active = true');
      expect(client.query).toHaveBeenNthCalledWith(4, "SELECT COUNT(*) FROM elections WHERE status = 'OPEN'");
      expect(client.query.mock.calls[6]?.[0]).toContain("WHERE e.status = 'OPEN'");
      expect(client.release).toHaveBeenCalledOnce();
    });

    it('returns zero participation and no ongoing elections when there are no voters', async () => {
      const client = makeClient();
      client.query
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      vi.mocked(mockPool.connect).mockResolvedValue(client as any);

      const result = await getStats();

      expect(result).toEqual({
        totalStudents: 0,
        activeStudents: 0,
        totalElections: 0,
        openElections: 0,
        totalVotes: 0,
        participation: 0,
        ongoingElections: [],
      });
      expect(client.release).toHaveBeenCalledOnce();
    });

    it('releases the client when a query fails', async () => {
      const client = makeClient();
      client.query
        .mockResolvedValueOnce({ rows: [{ count: '250' }] })
        .mockRejectedValueOnce(new Error('DB error'));

      vi.mocked(mockPool.connect).mockResolvedValue(client as any);

      await expect(getStats()).rejects.toThrow('DB error');
      expect(client.release).toHaveBeenCalledOnce();
    });
  });
});
