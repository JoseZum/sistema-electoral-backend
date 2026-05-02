import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';

vi.mock('../../../src/config/database', () => ({
  pool: {
    connect: vi.fn(),
    query: vi.fn(),
  },
}));

import { pool } from '../../../src/config/database';
import { withAuditContext } from '../../../src/config/audit-context';
import { auditRoutes } from '../../../src/modules/audit/index';

// Extract inline handlers from the Express router stack.
function getHandler(router: any, path: string) {
  const layer = router.stack.find((l: any) => l.route?.path === path);
  return layer?.route?.stack?.[0]?.handle as (
    req: Request,
    res: Response,
    next: NextFunction
  ) => Promise<void>;
}

const logsHandler = getHandler(auditRoutes, '/');
const statsHandler = getHandler(auditRoutes, '/stats');

function makeRes(): Response {
  const res = {} as any;
  res.json = vi.fn().mockReturnValue(res);
  res.status = vi.fn().mockReturnValue(res);
  return res as Response;
}

function makeReq(query: Record<string, string> = {}): Request {
  return { query, headers: {}, ip: undefined, socket: { remoteAddress: undefined } } as unknown as Request;
}

function makeNext(): NextFunction {
  return vi.fn() as unknown as NextFunction;
}

// Sets up pool.query to answer the COUNT then DATA queries used in GET /.
function mockLogsQuery(rows: Record<string, unknown>[] = [], total = rows.length) {
  vi.mocked(pool.query)
    .mockResolvedValueOnce({ rows: [{ count: String(total) }], rowCount: 1 } as any)
    .mockResolvedValueOnce({ rows, rowCount: rows.length } as any);
}

describe('audit', () => {
  let mockClient: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    };
    vi.mocked(pool.connect).mockResolvedValue(mockClient as any);
  });

  // ─── withAuditContext ─────────────────────────────────────────────────────

  describe('withAuditContext', () => {
    it('returns the result of the callback', async () => {
      const result = await withAuditContext({ id: 'u1' }, async () => 42);
      expect(result).toBe(42);
    });

    it('issues BEGIN before calling the callback', async () => {
      await withAuditContext({ id: 'u1' }, async () => {});
      expect(mockClient.query.mock.calls[0][0]).toBe('BEGIN');
    });

    it('sets actor_id session variable when actor.id is provided', async () => {
      await withAuditContext({ id: 'admin-uuid' }, async () => {});
      const queries: string[] = mockClient.query.mock.calls.map((c: any) => c[0]);
      expect(queries.some((q) => q.includes('app.actor_id') && q.includes('admin-uuid'))).toBe(true);
    });

    it('sets actor_carnet session variable when actor.carnet is provided', async () => {
      await withAuditContext({ carnet: '2021001234' }, async () => {});
      const queries: string[] = mockClient.query.mock.calls.map((c: any) => c[0]);
      expect(queries.some((q) => q.includes('app.actor_carnet') && q.includes('2021001234'))).toBe(true);
    });

    it('sets client_ip session variable when actor.ip is provided', async () => {
      await withAuditContext({ ip: '192.168.1.1' }, async () => {});
      const queries: string[] = mockClient.query.mock.calls.map((c: any) => c[0]);
      expect(queries.some((q) => q.includes('app.client_ip') && q.includes('192.168.1.1'))).toBe(true);
    });

    it('skips all session variable SET calls when actor is empty', async () => {
      await withAuditContext({}, async () => {});
      const queries: string[] = mockClient.query.mock.calls.map((c: any) => c[0]);
      expect(queries.some((q) => q.includes('app.actor_id'))).toBe(false);
      expect(queries.some((q) => q.includes('app.actor_carnet'))).toBe(false);
      expect(queries.some((q) => q.includes('app.client_ip'))).toBe(false);
    });

    it('issues COMMIT after the callback succeeds', async () => {
      await withAuditContext({ id: 'u1' }, async () => {});
      const queries: string[] = mockClient.query.mock.calls.map((c: any) => c[0]);
      expect(queries).toContain('COMMIT');
    });

    it('issues ROLLBACK and rethrows when callback throws', async () => {
      const err = new Error('boom');
      await expect(
        withAuditContext({ id: 'u1' }, async () => { throw err; })
      ).rejects.toThrow('boom');
      const queries: string[] = mockClient.query.mock.calls.map((c: any) => c[0]);
      expect(queries).toContain('ROLLBACK');
    });

    it('releases client on success', async () => {
      await withAuditContext({ id: 'u1' }, async () => {});
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('releases client even when callback throws', async () => {
      await expect(
        withAuditContext({ id: 'u1' }, async () => { throw new Error('fail'); })
      ).rejects.toThrow();
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  // ─── GET / ────────────────────────────────────────────────────────────────

  describe('GET /', () => {
    it('returns logs, total, page and limit', async () => {
      mockLogsQuery([{ id: '1', action: 'tag.insert', resource_type: 'tag' }], 1);
      const res = makeRes();
      await logsHandler(makeReq(), res, makeNext());
      const payload = vi.mocked(res.json).mock.calls[0][0] as any;
      expect(payload).toMatchObject({ logs: expect.any(Array), total: 1, page: 1, limit: 30 });
    });

    it('defaults to page 1 and limit 30', async () => {
      mockLogsQuery([]);
      const res = makeRes();
      await logsHandler(makeReq(), res, makeNext());
      const payload = vi.mocked(res.json).mock.calls[0][0] as any;
      expect(payload.page).toBe(1);
      expect(payload.limit).toBe(30);
    });

    it('uses page and limit from query params', async () => {
      mockLogsQuery([]);
      const res = makeRes();
      await logsHandler(makeReq({ page: '3', limit: '10' }), res, makeNext());
      const payload = vi.mocked(res.json).mock.calls[0][0] as any;
      expect(payload.page).toBe(3);
      expect(payload.limit).toBe(10);
    });

    it('caps limit at 100', async () => {
      mockLogsQuery([]);
      const res = makeRes();
      await logsHandler(makeReq({ limit: '999' }), res, makeNext());
      const payload = vi.mocked(res.json).mock.calls[0][0] as any;
      expect(payload.limit).toBe(100);
    });

    it('always excludes private resource types (vote, election_voter)', async () => {
      mockLogsQuery([]);
      await logsHandler(makeReq(), makeRes(), makeNext());
      const countSql = vi.mocked(pool.query).mock.calls[0][0] as string;
      const countParams = vi.mocked(pool.query).mock.calls[0][1] as unknown[];
      expect(countSql).toContain('NOT IN');
      expect(countParams).toContain('vote');
      expect(countParams).toContain('election_voter');
    });

    it('adds resource_type equality filter when provided', async () => {
      mockLogsQuery([]);
      await logsHandler(makeReq({ resource_type: 'election' }), makeRes(), makeNext());
      const dataSql = vi.mocked(pool.query).mock.calls[1][0] as string;
      const dataParams = vi.mocked(pool.query).mock.calls[1][1] as unknown[];
      expect(dataSql).toContain('al.resource_type = $');
      expect(dataParams).toContain('election');
    });

    it('adds action ILIKE filter when provided', async () => {
      mockLogsQuery([]);
      await logsHandler(makeReq({ action: 'tag.insert' }), makeRes(), makeNext());
      const dataParams = vi.mocked(pool.query).mock.calls[1][1] as unknown[];
      expect(dataParams).toContain('%tag.insert%');
    });

    it('adds search filter when provided', async () => {
      mockLogsQuery([]);
      await logsHandler(makeReq({ search: 'ana' }), makeRes(), makeNext());
      const dataParams = vi.mocked(pool.query).mock.calls[1][1] as unknown[];
      expect(dataParams).toContain('%ana%');
    });

    it('adds IN clause for resource_types and strips private types from it', async () => {
      mockLogsQuery([]);
      await logsHandler(makeReq({ resource_types: 'tag,vote,election' }), makeRes(), makeNext());
      const dataSql = vi.mocked(pool.query).mock.calls[1][0] as string;
      const dataParams = vi.mocked(pool.query).mock.calls[1][1] as unknown[];
      expect(dataSql).toContain('al.resource_type IN (');
      expect(dataParams).toContain('tag');
      expect(dataParams).toContain('election');
      // 'vote' comes only from the NOT IN clause, never added to the IN clause
      const voteCount = dataParams.filter((p) => p === 'vote').length;
      expect(voteCount).toBe(1);
    });

    it('omits IN clause when all resource_types values are private', async () => {
      mockLogsQuery([]);
      await logsHandler(makeReq({ resource_types: 'vote,election_voter' }), makeRes(), makeNext());
      const dataSql = vi.mocked(pool.query).mock.calls[1][0] as string;
      expect(dataSql).not.toContain('al.resource_type IN (');
    });

    it('enriches each row with actionLabel, resourceLabel and activityMessage', async () => {
      const row = { id: '1', action: 'tag.insert', resource_type: 'tag', resource_id: null };
      mockLogsQuery([row]);
      const res = makeRes();
      await logsHandler(makeReq(), res, makeNext());
      const { logs } = vi.mocked(res.json).mock.calls[0][0] as any;
      expect(logs[0]).toMatchObject({
        actionLabel: 'Tag creada',
        resourceLabel: 'tag',
        activityMessage: expect.any(String),
      });
    });

    it('calls next with error when pool.query throws', async () => {
      vi.mocked(pool.query).mockRejectedValue(new Error('DB down'));
      const next = makeNext();
      await logsHandler(makeReq(), makeRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  // ─── GET /stats ───────────────────────────────────────────────────────────

  describe('GET /stats', () => {
    it('returns stats rows from the database', async () => {
      const stats = [
        { resource_type: 'tag', count: '5', last_activity: new Date() },
        { resource_type: 'election', count: '2', last_activity: new Date() },
      ];
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: stats, rowCount: 2 } as any);
      const res = makeRes();
      await statsHandler({} as Request, res, makeNext());
      expect(res.json).toHaveBeenCalledWith(stats);
    });

    it('excludes private resource types from stats query', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
      await statsHandler({} as Request, makeRes(), makeNext());
      const sql = vi.mocked(pool.query).mock.calls[0][0] as string;
      const params = vi.mocked(pool.query).mock.calls[0][1] as unknown[];
      expect(sql).toContain('NOT IN');
      expect(params).toContain('vote');
      expect(params).toContain('election_voter');
    });

    it('calls next with error when pool.query throws', async () => {
      vi.mocked(pool.query).mockRejectedValue(new Error('Stats error'));
      const next = makeNext();
      await statsHandler({} as Request, makeRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  // ─── activityMessage (tested via GET / output) ────────────────────────────

  describe('activityMessage', () => {
    async function getMessage(row: Record<string, unknown>): Promise<string> {
      mockLogsQuery([row]);
      const res = makeRes();
      await logsHandler(makeReq(), res, makeNext());
      const { logs } = vi.mocked(res.json).mock.calls[0][0] as any;
      return logs[0].activityMessage;
    }

    it('formats tag.insert with tag name', async () => {
      const msg = await getMessage({
        action: 'tag.insert', resource_type: 'tag', tag_name: 'Ciencias', resource_id: null,
      });
      expect(msg).toBe('Tag creada "Ciencias"');
    });

    it('formats tag_member.insert with tag and person reference', async () => {
      const msg = await getMessage({
        action: 'tag_member.insert', resource_type: 'tag_member',
        tag_name: 'Ciencias', target_name: 'Ana García', target_carnet: '2021001234', resource_id: null,
      });
      expect(msg).toBe('Miembro agregado a tag en tag "Ciencias": Ana García · 2021001234');
    });

    it('formats tag_member message with only tag name when person info is absent', async () => {
      const msg = await getMessage({
        action: 'tag_member.delete', resource_type: 'tag_member',
        tag_name: 'Ciencias', target_name: null, target_carnet: null, resource_id: null,
      });
      expect(msg).toBe('Miembro eliminado de tag en tag "Ciencias"');
    });

    it('formats election action with election title', async () => {
      const msg = await getMessage({
        action: 'election.open', resource_type: 'election',
        election_title: 'Elección 2025', resource_id: null,
      });
      expect(msg).toBe('Eleccion abierta "Elección 2025"');
    });

    it('formats election.close with ballot count from details', async () => {
      const msg = await getMessage({
        action: 'election.close', resource_type: 'election',
        election_title: 'Elección 2025', resource_id: null,
        details: { ballots_count: 150 },
      });
      expect(msg).toBe('Votación cerrada de "Elección 2025" — 150 boletas emitidas');
    });

    it('includes holder name in scrutiny_key message', async () => {
      const msg = await getMessage({
        action: 'scrutiny_key.update', resource_type: 'scrutiny_key',
        election_title: 'Elección 2025', holder_name: 'Carlos López', resource_id: null,
      });
      expect(msg).toContain('Llave de escrutinio entregada');
      expect(msg).toContain('Elección 2025');
      expect(msg).toContain('Carlos López');
    });

    it('formats unknown action as title case', async () => {
      const msg = await getMessage({
        action: 'custom.action_type', resource_type: 'tag',
        tag_name: null, resource_id: 'uuid-1',
      });
      expect(msg).toContain('Custom action type');
    });

    it('returns "Actividad registrada en recurso" when action and resource_type are null', async () => {
      const msg = await getMessage({ action: null, resource_type: null, resource_id: null });
      expect(msg).toBe('Actividad registrada en recurso');
    });

    it('includes resource_id in generic fallback message', async () => {
      const msg = await getMessage({
        action: 'admin.insert', resource_type: 'admin', resource_id: 'uuid-99',
        target_name: null, election_title: null, tag_name: null,
      });
      expect(msg).toContain('uuid-99');
    });
  });
});
