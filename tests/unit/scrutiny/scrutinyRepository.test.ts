import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addMembersElection,
  checkDuplicate,
  checkKey,
  finalizeScrutine,
  getScrutinyProgress,
  getStateKeys,
  submitKeys,
} from '../../../src/modules/scrutiny/repositories/scrutinyRepository';
import { Election } from '../../../src/modules/elections/models/electionModel';
import { scrutinykeys, submitKeyDTO } from '../../../src/modules/scrutiny/models/scrutiny.types';

const mockPool = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
}));

vi.mock('../../../src/config/database', () => ({ pool: mockPool }));

const mockElection: Election = {
  id: 'election-1',
  title: 'Student Council 2026',
  description: 'General election',
  status: 'CLOSED',
  is_anonymous: true,
  auth_method: 'MICROSOFT',
  voter_source: 'FULL_PADRON',
  voter_filter: null,
  tag_id: null,
  starts_immediately: false,
  immediate_minutes: null,
  requires_keys: true,
  min_keys: 2,
  start_time: new Date('2026-05-01T10:00:00.000Z'),
  end_time: new Date('2026-05-02T18:00:00.000Z'),
  created_by: 'admin-1',
  created_at: new Date('2026-04-20T10:00:00.000Z'),
  updated_at: new Date('2026-04-25T10:00:00.000Z'),
};

const mockPendingMember = {
  id: 'student-1',
  full_name: 'Ana Perez',
  carnet: '202400001',
  date: new Date('2026-05-02T18:30:00.000Z'),
  has_submitted: false,
};

const mockSubmittedKey: scrutinykeys = {
  id: 'key-1',
  election_id: 'election-1',
  member_id: 'student-1',
  key_shard: 'stored-hash',
  has_submitted: true,
  submitted_at: new Date('2026-05-02T18:45:00.000Z'),
};

const mockSubmitData: submitKeyDTO = {
  election_id: 'election-1',
  member_id: 'student-1',
  key_shard: 'plain-key',
};

function makeDb(rows: unknown[], rowCount = rows.length) {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount }) };
}

function makeTransactionalClient(
  resolver: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number }> | { rows: unknown[]; rowCount?: number }
) {
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [], rowCount: 0 };
      }

      return resolver(sql, params);
    }),
    release: vi.fn(),
  };
}

describe('scrutinyRepository', () => {
  beforeEach(() => {
    mockPool.query.mockReset();
    mockPool.connect.mockReset();
  });

  describe('getScrutinyProgress', () => {
    it('parses scrutiny counters from the aggregated query result', async () => {
      const db = makeDb([{ total_members: '5', submitted_key: '3', pending: '2' }]);

      const result = await getScrutinyProgress('election-1', db as any);

      expect(result).toEqual({
        total_Members: 5,
        submittedKeys: 3,
        pending: 2,
      });
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining('FROM scrutiny_keys sk'), ['election-1']);
    });

    it('returns zero counters when the election has no scrutiny rows', async () => {
      const db = makeDb([]);

      const result = await getScrutinyProgress('missing-election', db as any);

      expect(result).toEqual({
        total_Members: 0,
        submittedKeys: 0,
        pending: 0,
      });
    });
  });

  describe('getStateKeys', () => {
    it('returns the members assigned to scrutiny keys for an election', async () => {
      mockPool.query.mockResolvedValue({ rows: [mockPendingMember] });

      const result = await getStateKeys('election-1');

      expect(result).toEqual([mockPendingMember]);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INNER JOIN students s ON sk.member_id = s.id'),
        ['election-1']
      );
    });
  });

  describe('addMembersElection', () => {
    it('rejects when students_id is empty', async () => {
      await expect(
        addMembersElection('election-1', { option: '0', students_id: [] }, ['hash-1'])
      ).rejects.toMatchObject({
        status: 400,
        code: 'SCRUTINY_MEMBERS_REQUIRED',
      });
      expect(mockPool.connect).not.toHaveBeenCalled();
    });

    it('rejects when keysHash length does not match students_id length', async () => {
      await expect(
        addMembersElection('election-1', { option: '0', students_id: ['student-1', 'student-2'] }, ['hash-1'])
      ).rejects.toMatchObject({
        status: 500,
        code: 'SCRUTINY_KEY_HASH_MISMATCH',
      });
      expect(mockPool.connect).not.toHaveBeenCalled();
    });

    it('inserts one row per member inside a transaction', async () => {
      const client = makeTransactionalClient(async (sql) => {
        if (sql.includes('INSERT INTO scrutiny_keys')) {
          return { rows: [], rowCount: 2 };
        }

        throw new Error(`Unexpected query: ${sql}`);
      });

      mockPool.connect.mockResolvedValue(client as any);

      const result = await addMembersElection(
        'election-1',
        { option: '1', students_id: ['student-1', 'student-2'] },
        ['hash-1', 'hash-2']
      );

      expect(result).toBe(true);
      expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN');
      expect(client.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('INSERT INTO scrutiny_keys'),
        ['election-1', 'student-1', 'hash-1', 'student-2', 'hash-2']
      );
      expect(client.query).toHaveBeenNthCalledWith(3, 'COMMIT');

      const insertSql = client.query.mock.calls[1][0] as string;
      expect(insertSql).toContain('VALUES ($1, $2, $3, false), ($1, $4, $5, false)');
      expect(insertSql).toContain('ON CONFLICT (election_id, member_id)');
      expect(insertSql).toContain('submitted_at = null');
      expect(client.release).toHaveBeenCalledOnce();
    });

    it('rolls back and releases the client when a key hash is missing after BEGIN', async () => {
      const client = makeTransactionalClient(async (sql) => {
        if (sql.includes('INSERT INTO scrutiny_keys')) {
          return { rows: [], rowCount: 0 };
        }

        throw new Error(`Unexpected query: ${sql}`);
      });

      mockPool.connect.mockResolvedValue(client as any);

      await expect(
        addMembersElection(
          'election-1',
          { option: '1', students_id: ['student-1', 'student-2'] },
          ['hash-1', undefined as unknown as string]
        )
      ).rejects.toMatchObject({
        status: 500,
        code: 'SCRUTINY_KEY_HASH_MISSING',
      });

      expect(client.query).toHaveBeenCalledWith('ROLLBACK');
      expect(client.release).toHaveBeenCalledOnce();
    });
  });

  describe('checkKey', () => {
    it('returns true when the stored hashed key is valid and unused', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ exists: true }] });

      const result = await checkKey(mockSubmitData, 'hashed-key');

      expect(result).toBe(true);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('AND s.key_shard = $3'),
        ['election-1', 'student-1', 'hashed-key']
      );
    });

    it('returns false when the query does not find a usable key', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await checkKey(mockSubmitData, 'missing-key');

      expect(result).toBe(false);
    });
  });

  describe('checkDuplicate', () => {
    it('returns whether any supplied member is already assigned and builds an OR clause', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ exists: true }] });

      const result = await checkDuplicate(['student-1', 'student-2'], 'election-1');

      expect(result).toBe(true);
      const sql = mockPool.query.mock.calls[0][0] as string;
      const params = mockPool.query.mock.calls[0][1] as unknown[];
      expect(sql).toContain('s.member_id = $2');
      expect(sql).toContain('OR s.member_id = $3');
      expect(params).toEqual(['election-1', 'student-1', 'student-2']);
    });
  });

  describe('submitKeys', () => {
    it('marks the scrutiny key as submitted and returns the updated row', async () => {
      mockPool.query.mockResolvedValue({ rows: [mockSubmittedKey] });

      const result = await submitKeys(mockSubmitData);

      expect(result).toEqual(mockSubmittedKey);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE scrutiny_Keys SET has_submitted = true'),
        ['election-1', 'student-1']
      );
    });

    it('returns null when no pending scrutiny key matches the member', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await submitKeys(mockSubmitData);

      expect(result).toBeNull();
    });
  });

  describe('finalizeScrutine', () => {
    it('finalizes a closed election, writes the audit record, and commits the transaction', async () => {
      const updatedElection: Election = { ...mockElection, status: 'SCRUTINIZED' };
      const client = makeTransactionalClient(async (sql) => {
        if (sql.includes('SELECT * FROM elections WHERE id = $1 FOR UPDATE')) {
          return { rows: [mockElection], rowCount: 1 };
        }

        if (sql.includes('FROM scrutiny_keys sk')) {
          return { rows: [{ total_members: '3', submitted_key: '2', pending: '1' }], rowCount: 1 };
        }

        if (sql.includes('UPDATE elections')) {
          return { rows: [updatedElection], rowCount: 1 };
        }

        if (sql.includes('INSERT INTO audit_logs')) {
          return { rows: [], rowCount: 1 };
        }

        throw new Error(`Unexpected query: ${sql}`);
      });

      mockPool.connect.mockResolvedValue(client as any);

      const result = await finalizeScrutine('election-1', 'admin-1');

      expect(result).toEqual(updatedElection);
      expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN');
      expect(client.query).toHaveBeenLastCalledWith('COMMIT');
      expect(client.release).toHaveBeenCalledOnce();

      const auditCall = client.query.mock.calls.find(([sql]) => (sql as string).includes('INSERT INTO audit_logs'));
      expect(auditCall).toBeDefined();
      expect(auditCall?.[1]).toEqual([
        'admin-1',
        'scrutiny.finalize',
        'election',
        'election-1',
        JSON.stringify({
          election_title: 'Student Council 2026',
          requires_keys: true,
          required_keys: 2,
          submitted_keys: 2,
          total_members: 3,
        }),
      ]);
    });

    it('rolls back when the election does not exist', async () => {
      const client = makeTransactionalClient(async (sql) => {
        if (sql.includes('SELECT * FROM elections WHERE id = $1 FOR UPDATE')) {
          return { rows: [], rowCount: 0 };
        }

        throw new Error(`Unexpected query: ${sql}`);
      });

      mockPool.connect.mockResolvedValue(client as any);

      await expect(finalizeScrutine('missing-election')).rejects.toMatchObject({
        status: 404,
        code: 'SCRUTINY_ELECTION_NOT_FOUND',
      });

      expect(client.query).toHaveBeenCalledWith('ROLLBACK');
      expect(client.release).toHaveBeenCalledOnce();
    });

    it('rolls back when the election was already scrutinized', async () => {
      const client = makeTransactionalClient(async (sql) => {
        if (sql.includes('SELECT * FROM elections WHERE id = $1 FOR UPDATE')) {
          return { rows: [{ ...mockElection, status: 'SCRUTINIZED' }], rowCount: 1 };
        }

        throw new Error(`Unexpected query: ${sql}`);
      });

      mockPool.connect.mockResolvedValue(client as any);

      await expect(finalizeScrutine('election-1')).rejects.toMatchObject({
        status: 409,
        code: 'SCRUTINY_ELECTION_ALREADY_FINALIZED',
      });

      expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    });

    it('rolls back when the election is not closed', async () => {
      const client = makeTransactionalClient(async (sql) => {
        if (sql.includes('SELECT * FROM elections WHERE id = $1 FOR UPDATE')) {
          return { rows: [{ ...mockElection, status: 'OPEN' }], rowCount: 1 };
        }

        throw new Error(`Unexpected query: ${sql}`);
      });

      mockPool.connect.mockResolvedValue(client as any);

      await expect(finalizeScrutine('election-1')).rejects.toMatchObject({
        status: 409,
        code: 'SCRUTINY_FINALIZE_ELECTION_NOT_CLOSED',
      });

      expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    });

    it('rolls back when submitted scrutiny keys are below the minimum required', async () => {
      const client = makeTransactionalClient(async (sql) => {
        if (sql.includes('SELECT * FROM elections WHERE id = $1 FOR UPDATE')) {
          return { rows: [{ ...mockElection, min_keys: 3 }], rowCount: 1 };
        }

        if (sql.includes('FROM scrutiny_keys sk')) {
          return { rows: [{ total_members: '4', submitted_key: '2', pending: '2' }], rowCount: 1 };
        }

        throw new Error(`Unexpected query: ${sql}`);
      });

      mockPool.connect.mockResolvedValue(client as any);

      await expect(finalizeScrutine('election-1')).rejects.toMatchObject({
        status: 409,
        code: 'SCRUTINY_KEYS_INSUFFICIENT',
        details: {
          submittedKeys: 2,
          minKeys: 3,
        },
      });

      expect(client.query).toHaveBeenCalledWith('ROLLBACK');
      expect(client.release).toHaveBeenCalledOnce();
    });
  });
});
