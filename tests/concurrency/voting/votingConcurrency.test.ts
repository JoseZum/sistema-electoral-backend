import crypto from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';

const CONCURRENT_REQUESTS = 50;

const mockAuth = vi.hoisted(() => ({
  verifySessionJWT: vi.fn(),
}));

const mockDb = vi.hoisted(() => {
  const namedElectionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const anonymousElectionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const namedOptionId = '11111111-1111-4111-8111-111111111111';
  const anonymousOptionId = '22222222-2222-4222-8222-222222222222';
  const sameNamedStudentId = '33333333-3333-4333-8333-333333333333';
  const anonymousStudentId = '44444444-4444-4444-8444-444444444444';

  type Student = {
    id: string;
    carnet: string;
    full_name: string;
    email: string;
    is_active: boolean;
  };

  type Election = {
    id: string;
    title: string;
    description: string | null;
    status: string;
    is_anonymous: boolean;
    tag_name: string | null;
    tag_color: string | null;
    start_time: Date | null;
    end_time: Date | null;
  };

  type ElectionVoter = {
    election_id: string;
    student_id: string;
    token_used: boolean;
    token_used_at: Date | null;
  };

  type ElectionOption = {
    id: string;
    election_id: string;
    label: string;
    option_type: string;
    display_order: number;
  };

  type VotingToken = {
    election_id: string;
    student_id: string;
    token_hash: string | null;
    token_encrypted: string | null;
    used: boolean;
    used_at: Date | null;
  };

  type Vote = {
    id: string;
    election_id: string;
    option_id: string;
    student_id: string | null;
    token_hash: string | null;
  };

  type Barrier = {
    wait: () => Promise<void>;
    waiting: () => number;
  };

  let students: Student[] = [];
  let elections: Election[] = [];
  let electionVoters: ElectionVoter[] = [];
  let options: ElectionOption[] = [];
  let votingTokens: VotingToken[] = [];
  let votes: Vote[] = [];
  let voteSequence = 1;
  let namedCastBarrier: Barrier | null = null;
  let anonymousCastBarrier: Barrier | null = null;

  function createBarrier(size: number): Barrier {
    let waiting = 0;
    let release: (() => void) | null = null;
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });

    return {
      waiting: () => waiting,
      wait: async () => {
        waiting += 1;
        if (waiting >= size) {
          release?.();
        }
        await releasePromise;
      },
    };
  }

  function resetState() {
    voteSequence = 1;
    namedCastBarrier = null;
    anonymousCastBarrier = null;
    students = [
      {
        id: sameNamedStudentId,
        carnet: '2026000001',
        full_name: 'Votante Nominal Compartido',
        email: 'same-named@estudiantec.cr',
        is_active: true,
      },
      {
        id: anonymousStudentId,
        carnet: '2026000002',
        full_name: 'Votante Anonimo Compartido',
        email: 'anonymous@estudiantec.cr',
        is_active: true,
      },
    ];
    elections = [
      {
        id: namedElectionId,
        title: 'Consulta nominal concurrente',
        description: null,
        status: 'OPEN',
        is_anonymous: false,
        tag_name: null,
        tag_color: null,
        start_time: new Date('2026-05-04T12:00:00.000Z'),
        end_time: new Date('2026-05-05T12:00:00.000Z'),
      },
      {
        id: anonymousElectionId,
        title: 'Consulta anonima concurrente',
        description: null,
        status: 'OPEN',
        is_anonymous: true,
        tag_name: null,
        tag_color: null,
        start_time: new Date('2026-05-04T12:00:00.000Z'),
        end_time: new Date('2026-05-05T12:00:00.000Z'),
      },
    ];
    electionVoters = [
      {
        election_id: namedElectionId,
        student_id: sameNamedStudentId,
        token_used: false,
        token_used_at: null,
      },
      {
        election_id: anonymousElectionId,
        student_id: anonymousStudentId,
        token_used: false,
        token_used_at: null,
      },
    ];
    options = [
      {
        id: namedOptionId,
        election_id: namedElectionId,
        label: 'Aprobar',
        option_type: 'yes_no',
        display_order: 1,
      },
      {
        id: anonymousOptionId,
        election_id: anonymousElectionId,
        label: 'Formula Azul',
        option_type: 'ticket',
        display_order: 1,
      },
    ];
    votingTokens = [];
    votes = [];
  }

  function nextVoteId() {
    return `vote-${String(voteSequence++).padStart(4, '0')}`;
  }

  function electionById(id: unknown) {
    return elections.find((election) => election.id === id) || null;
  }

  function activeStudentByEmail(email: unknown) {
    const normalizedEmail = String(email).toLowerCase();
    return (
      students.find(
        (student) => student.email.toLowerCase() === normalizedEmail && student.is_active
      ) || null
    );
  }

  function voterRow(electionId: string, studentId: string) {
    return (
      electionVoters.find(
        (voter) => voter.election_id === electionId && voter.student_id === studentId
      ) || null
    );
  }

  function optionBelongsToElection(electionId: string, optionId: string) {
    return options.some((option) => option.id === optionId && option.election_id === electionId);
  }

  function duplicateVoteError() {
    return new Error('duplicate key value violates unique constraint "uniq_votes_student"');
  }

  function tokenUsedError() {
    return new Error('token invalido o utilizado');
  }

  function findElectionForVoter(electionId: string, studentId: string) {
    const election = electionById(electionId);
    const voter = voterRow(electionId, studentId);

    if (!election || !voter) {
      return null;
    }

    return {
      ...election,
      has_voted: voter.token_used,
    };
  }

  function seedNamedVoters(count: number) {
    const seeded: Array<{ token: string; email: string; studentId: string }> = [];

    for (let index = 0; index < count; index += 1) {
      const studentId = `50000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
      const email = `named-voter-${index}@estudiantec.cr`;
      const token = `named-voter-${index}`;

      students.push({
        id: studentId,
        carnet: `2026${String(index + 1).padStart(6, '0')}`,
        full_name: `Votante Concurrente ${index + 1}`,
        email,
        is_active: true,
      });
      electionVoters.push({
        election_id: namedElectionId,
        student_id: studentId,
        token_used: false,
        token_used_at: null,
      });
      seeded.push({ token, email, studentId });
    }

    return seeded;
  }

  function seedAnonymousTokenForStudent(
    studentId: string,
    tokenEncrypted: string,
    tokenHash: string
  ) {
    const existing = votingTokens.find(
      (token) => token.election_id === anonymousElectionId && token.student_id === studentId
    );

    if (existing) {
      existing.token_encrypted = tokenEncrypted;
      existing.token_hash = tokenHash;
      existing.used = false;
      existing.used_at = null;
      return;
    }

    votingTokens.push({
      election_id: anonymousElectionId,
      student_id: studentId,
      token_hash: tokenHash,
      token_encrypted: tokenEncrypted,
      used: false,
      used_at: null,
    });
  }

  async function castNamedVote(electionId: string, optionId: string, studentId: string) {
    if (namedCastBarrier) {
      await namedCastBarrier.wait();
    }

    const voter = voterRow(electionId, studentId);
    if (!voter) {
      throw new Error('voter is not eligible');
    }

    if (!optionBelongsToElection(electionId, optionId)) {
      throw new Error('option does not belong to election');
    }

    if (
      votes.some(
        (vote) => vote.election_id === electionId && vote.student_id === studentId
      )
    ) {
      throw duplicateVoteError();
    }

    const now = new Date();
    voter.token_used = true;
    voter.token_used_at = now;
    votes.push({
      id: nextVoteId(),
      election_id: electionId,
      option_id: optionId,
      student_id: studentId,
      token_hash: null,
    });
  }

  async function castAnonymousVote(electionId: string, optionId: string, tokenHash: string) {
    if (anonymousCastBarrier) {
      await anonymousCastBarrier.wait();
    }

    const token = votingTokens.find(
      (item) => item.election_id === electionId && item.token_hash === tokenHash && !item.used
    );

    if (!token) {
      throw tokenUsedError();
    }

    if (!optionBelongsToElection(electionId, optionId)) {
      throw new Error('option does not belong to election');
    }

    if (votes.some((vote) => vote.token_hash === tokenHash)) {
      throw tokenUsedError();
    }

    const now = new Date();
    token.used = true;
    token.used_at = now;
    token.token_hash = null;
    token.token_encrypted = null;

    const voter = voterRow(electionId, token.student_id);
    if (voter) {
      voter.token_used = true;
      voter.token_used_at = now;
    }

    votes.push({
      id: nextVoteId(),
      election_id: electionId,
      option_id: optionId,
      student_id: null,
      token_hash: tokenHash,
    });
  }

  async function runQuery(sqlInput: string, params: unknown[] = []) {
    const sql = sqlInput.replace(/\s+/g, ' ').trim();

    if (sql.startsWith('UPDATE elections SET status = CASE')) {
      return { rows: [], rowCount: 0 };
    }

    if (sql.startsWith('SELECT id, carnet, full_name FROM students WHERE email = $1')) {
      const student = activeStudentByEmail(params[0]);
      return {
        rows: student
          ? [{ id: student.id, carnet: student.carnet, full_name: student.full_name }]
          : [],
        rowCount: student ? 1 : 0,
      };
    }

    if (
      sql.startsWith('SELECT e.id') &&
      sql.includes('INNER JOIN election_voters ev') &&
      sql.includes('WHERE e.id = $1')
    ) {
      const [electionId, studentId] = params as [string, string];
      const row = findElectionForVoter(electionId, studentId);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    if (sql.startsWith('SELECT ev.student_id') && sql.includes('FROM election_voters ev')) {
      const rows = electionVoters
        .filter((voter) => voter.election_id === params[0] && !voter.token_used)
        .map((voter) => students.find((student) => student.id === voter.student_id))
        .filter((student): student is Student => Boolean(student?.is_active))
        .map((student) => ({
          student_id: student.id,
          carnet: student.carnet,
          full_name: student.full_name,
        }));
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith('INSERT INTO voting_tokens')) {
      const electionIds = params[0] as string[];
      const studentIds = params[1] as string[];
      const tokenHashes = params[2] as string[];
      const encryptedTokens = params[3] as string[];
      const inserted: Array<{ student_id: string }> = [];

      electionIds.forEach((electionId, index) => {
        const studentId = studentIds[index];
        const exists = votingTokens.some(
          (token) => token.election_id === electionId && token.student_id === studentId
        );

        if (!exists) {
          votingTokens.push({
            election_id: electionId,
            student_id: studentId,
            token_hash: tokenHashes[index],
            token_encrypted: encryptedTokens[index],
            used: false,
            used_at: null,
          });
          inserted.push({ student_id: studentId });
        }
      });

      return { rows: inserted, rowCount: inserted.length };
    }

    if (sql.startsWith('SELECT token_encrypted FROM voting_tokens')) {
      const token = votingTokens.find(
        (item) =>
          item.election_id === params[0] &&
          item.student_id === params[1] &&
          !item.used &&
          item.token_encrypted
      );
      return {
        rows: token ? [{ token_encrypted: token.token_encrypted }] : [],
        rowCount: token ? 1 : 0,
      };
    }

    if (sql === 'SELECT fn_cast_vote_named($1, $2, $3)') {
      await castNamedVote(String(params[0]), String(params[1]), String(params[2]));
      return { rows: [], rowCount: 1 };
    }

    if (sql === 'SELECT fn_cast_vote_anonymous($1, $2, $3)') {
      await castAnonymousVote(String(params[0]), String(params[1]), String(params[2]));
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`Unhandled SQL in voting concurrency test: ${sql}`);
  }

  const query = vi.fn(runQuery);

  resetState();

  return {
    ids: {
      namedElectionId,
      anonymousElectionId,
      namedOptionId,
      anonymousOptionId,
      sameNamedStudentId,
      anonymousStudentId,
    },
    query,
    resetState,
    seedNamedVoters,
    seedAnonymousTokenForStudent,
    setNamedCastBarrier: (size: number) => {
      namedCastBarrier = createBarrier(size);
    },
    setAnonymousCastBarrier: (size: number) => {
      anonymousCastBarrier = createBarrier(size);
    },
    getVotesForElection: (electionId: string) =>
      votes.filter((vote) => vote.election_id === electionId),
    getVoter: (electionId: string, studentId: string) => voterRow(electionId, studentId),
    getVotingToken: (electionId: string, studentId: string) =>
      votingTokens.find(
        (token) => token.election_id === electionId && token.student_id === studentId
      ) || null,
  };
});

vi.mock('../../../src/modules/auth/services/jwtUtils', () => ({
  verifySessionJWT: mockAuth.verifySessionJWT,
  createSessionJWT: vi.fn(),
}));

vi.mock('../../../src/config/database', () => ({
  pool: {
    query: mockDb.query,
    connect: vi.fn(),
    on: vi.fn(),
  },
}));

import { env } from '../../../src/config/env';
import app from '../../../src/index';

type RequestOptions = {
  token?: string;
  body: unknown;
};

function hashVoteTokenForTest(token: string): string {
  return crypto.createHash('sha256').update(`${token}${env.voteTokenSecret}`).digest('hex');
}

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

function countStatus(results: Array<{ response: Response }>, status: number) {
  return results.filter((result) => result.response.status === status).length;
}

describe('voting concurrency', () => {
  let server: Server;
  let baseUrl: string;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    server = await new Promise<Server>((resolve) => {
      const runningServer = app.listen(0, () => resolve(runningServer));
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Could not resolve test server address');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    consoleErrorSpy.mockRestore();
  });

  beforeEach(() => {
    mockDb.resetState();
    mockDb.query.mockClear();
    mockAuth.verifySessionJWT.mockReset();
    mockAuth.verifySessionJWT.mockImplementation((token: string) => {
      if (token === 'same-named-voter') {
        return {
          studentId: mockDb.ids.sameNamedStudentId,
          carnet: '2026000001',
          email: 'same-named@estudiantec.cr',
          fullName: 'Votante Nominal Compartido',
          role: 'voter',
        };
      }

      if (token === 'anonymous-voter') {
        return {
          studentId: mockDb.ids.anonymousStudentId,
          carnet: '2026000002',
          email: 'anonymous@estudiantec.cr',
          fullName: 'Votante Anonimo Compartido',
          role: 'voter',
        };
      }

      if (token.startsWith('named-voter-')) {
        const index = Number(token.replace('named-voter-', ''));
        return {
          studentId: `50000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
          carnet: `2026${String(index + 1).padStart(6, '0')}`,
          email: `named-voter-${index}@estudiantec.cr`,
          fullName: `Votante Concurrente ${index + 1}`,
          role: 'voter',
        };
      }

      throw new Error('invalid token');
    });
  });

  async function request(path: string, options: RequestOptions) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${options.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(options.body),
    });
    const body = await response.json();
    return { response, body };
  }

  it('allows only one of 50 simultaneous named vote requests from the same voter', async () => {
    mockDb.setNamedCastBarrier(CONCURRENT_REQUESTS);

    const results = await Promise.all(
      Array.from({ length: CONCURRENT_REQUESTS }, () =>
        request('/api/voting/cast', {
          token: 'same-named-voter',
          body: {
            electionId: mockDb.ids.namedElectionId,
            optionId: mockDb.ids.namedOptionId,
          },
        })
      )
    );

    expect(countStatus(results, 200)).toBe(1);
    expect(countStatus(results, 409)).toBe(CONCURRENT_REQUESTS - 1);
    expect(results.filter((result) => result.response.status === 409)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          body: expect.objectContaining({ code: 'VOTING_ALREADY_VOTED' }),
        }),
      ])
    );
    expect(mockDb.getVotesForElection(mockDb.ids.namedElectionId)).toHaveLength(1);
    expect(
      mockDb.getVoter(mockDb.ids.namedElectionId, mockDb.ids.sameNamedStudentId)
    ).toMatchObject({
      token_used: true,
    });
  });

  it('records all votes when 50 different eligible voters vote at the same time', async () => {
    const voters = mockDb.seedNamedVoters(CONCURRENT_REQUESTS);
    mockDb.setNamedCastBarrier(CONCURRENT_REQUESTS);

    const results = await Promise.all(
      voters.map((voter) =>
        request('/api/voting/cast', {
          token: voter.token,
          body: {
            electionId: mockDb.ids.namedElectionId,
            optionId: mockDb.ids.namedOptionId,
          },
        })
      )
    );

    expect(countStatus(results, 200)).toBe(CONCURRENT_REQUESTS);
    expect(mockDb.getVotesForElection(mockDb.ids.namedElectionId)).toHaveLength(
      CONCURRENT_REQUESTS
    );
    expect(
      new Set(
        mockDb
          .getVotesForElection(mockDb.ids.namedElectionId)
          .map((vote) => vote.student_id)
      )
    ).toHaveSize(CONCURRENT_REQUESTS);
    voters.forEach((voter) => {
      expect(mockDb.getVoter(mockDb.ids.namedElectionId, voter.studentId)).toMatchObject({
        token_used: true,
      });
    });
  });

  it('allows only one of 50 simultaneous anonymous vote requests using the same voter token', async () => {
    const token = 'known-anonymous-token';
    const tokenHash = hashVoteTokenForTest(token);
    mockDb.seedAnonymousTokenForStudent(
      mockDb.ids.anonymousStudentId,
      encryptVoteTokenForTest(token),
      tokenHash
    );
    mockDb.setAnonymousCastBarrier(CONCURRENT_REQUESTS);

    const results = await Promise.all(
      Array.from({ length: CONCURRENT_REQUESTS }, () =>
        request('/api/voting/cast', {
          token: 'anonymous-voter',
          body: {
            electionId: mockDb.ids.anonymousElectionId,
            optionId: mockDb.ids.anonymousOptionId,
          },
        })
      )
    );

    const votes = mockDb.getVotesForElection(mockDb.ids.anonymousElectionId);
    const tokenRecord = mockDb.getVotingToken(
      mockDb.ids.anonymousElectionId,
      mockDb.ids.anonymousStudentId
    );

    expect(countStatus(results, 200)).toBe(1);
    expect(countStatus(results, 409)).toBe(CONCURRENT_REQUESTS - 1);
    expect(results.filter((result) => result.response.status === 409)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          body: expect.objectContaining({ code: 'VOTING_TOKEN_INVALID_OR_USED' }),
        }),
      ])
    );
    expect(votes).toHaveLength(1);
    expect(votes[0]).toMatchObject({
      student_id: null,
      token_hash: tokenHash,
    });
    expect(tokenRecord).toMatchObject({
      used: true,
      token_hash: null,
      token_encrypted: null,
    });
  });

  it('keeps the database-level concurrency guardrails documented in schema SQL', () => {
    const schemaSql = readFileSync(
      join(process.cwd(), 'supabase', 'schema', '01-schema.sql'),
      'utf8'
    ).replace(/\s+/g, ' ');
    const storedProcedureSql = readFileSync(
      join(process.cwd(), 'supabase', 'schema', '02-storedprocedures.sql'),
      'utf8'
    ).replace(/\s+/g, ' ');

    expect(schemaSql).toContain(
      'CREATE UNIQUE INDEX uniq_votes_student ON votes(election_id, student_id) WHERE student_id IS NOT NULL'
    );
    expect(schemaSql).toContain(
      'CREATE UNIQUE INDEX uniq_votes_token ON votes(token_hash) WHERE token_hash IS NOT NULL'
    );
    expect(schemaSql).toContain('CREATE UNIQUE INDEX uniq_voting_tokens_hash');
    expect(storedProcedureSql).toContain('FROM voting_tokens WHERE election_id = p_election_id');
    expect(storedProcedureSql).toContain('FOR UPDATE');
  });
});
