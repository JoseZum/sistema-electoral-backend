import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';

const mockAuth = vi.hoisted(() => ({
  verifySessionJWT: vi.fn(),
}));

const mockDb = vi.hoisted(() => {
  const voterStudentId = '11111111-1111-4111-8111-111111111111';
  const secondVoterStudentId = '22222222-2222-4222-8222-222222222222';
  const inactiveStudentId = '33333333-3333-4333-8333-333333333333';
  const anonymousElectionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const namedElectionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const closedElectionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const scheduledElectionId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const restrictedElectionId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const anonymousOptionOneId = '01010101-0101-4101-8101-010101010101';
  const anonymousOptionTwoId = '02020202-0202-4202-8202-020202020202';
  const namedOptionOneId = '03030303-0303-4303-8303-030303030303';
  const namedOptionTwoId = '04040404-0404-4404-8404-040404040404';
  const closedOptionOneId = '05050505-0505-4505-8505-050505050505';
  const closedOptionTwoId = '06060606-0606-4606-8606-060606060606';
  const scheduledOptionId = '07070707-0707-4707-8707-070707070707';
  const startTime = new Date('2026-05-04T12:00:00.000Z');
  const endTime = new Date('2026-05-05T12:00:00.000Z');

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
    allow_suboptions: boolean;
    tag_name: string | null;
    tag_color: string | null;
    start_time: Date | null;
    end_time: Date | null;
  };

  type ElectionVoter = {
    election_id: string;
    student_id: string;
    token_used: boolean;
  };

  type ElectionOption = {
    id: string;
    election_id: string;
    parent_option_id: string | null;
    label: string;
    option_type: string;
    image_url: string | null;
    display_order: number;
    metadata: Record<string, unknown> | null;
  };

  type VotingToken = {
    election_id: string;
    student_id: string;
    token_hash: string;
    token_encrypted: string;
    used: boolean;
  };

  type Vote = {
    id: string;
    election_id: string;
    option_id: string;
    parent_option_id: string | null;
    student_id: string | null;
    token_hash: string | null;
  };

  let students: Student[] = [];
  let elections: Election[] = [];
  let electionVoters: ElectionVoter[] = [];
  let options: ElectionOption[] = [];
  let votingTokens: VotingToken[] = [];
  let votes: Vote[] = [];
  let voteSequence = 1;

  function resetState() {
    voteSequence = 1;
    students = [
      {
        id: voterStudentId,
        carnet: '2021001234',
        full_name: 'Valeria Votante',
        email: 'voter@estudiantec.cr',
        is_active: true,
      },
      {
        id: secondVoterStudentId,
        carnet: '2021005678',
        full_name: 'Sebastian Votante',
        email: 'second@estudiantec.cr',
        is_active: true,
      },
      {
        id: inactiveStudentId,
        carnet: '2021009999',
        full_name: 'Persona Inactiva',
        email: 'inactive@estudiantec.cr',
        is_active: false,
      },
    ];

    elections = [
      {
        id: anonymousElectionId,
        title: 'Eleccion anonima FEITEC',
        description: 'Votacion anonima de prueba',
        status: 'OPEN',
        is_anonymous: true,
        allow_suboptions: false,
        tag_name: 'Computacion',
        tag_color: '#283593',
        start_time: startTime,
        end_time: endTime,
      },
      {
        id: namedElectionId,
        title: 'Consulta nominal',
        description: 'Votacion no anonima de prueba',
        status: 'OPEN',
        is_anonymous: false,
        allow_suboptions: false,
        tag_name: null,
        tag_color: null,
        start_time: startTime,
        end_time: endTime,
      },
      {
        id: closedElectionId,
        title: 'Resultados publicados',
        description: null,
        status: 'CLOSED',
        is_anonymous: false,
        allow_suboptions: false,
        tag_name: null,
        tag_color: null,
        start_time: new Date('2026-05-01T12:00:00.000Z'),
        end_time: new Date('2026-05-02T12:00:00.000Z'),
      },
      {
        id: scheduledElectionId,
        title: 'Votacion programada',
        description: null,
        status: 'SCHEDULED',
        is_anonymous: false,
        allow_suboptions: false,
        tag_name: null,
        tag_color: null,
        start_time: new Date('2026-05-10T12:00:00.000Z'),
        end_time: new Date('2026-05-11T12:00:00.000Z'),
      },
      {
        id: restrictedElectionId,
        title: 'Eleccion restringida',
        description: null,
        status: 'OPEN',
        is_anonymous: false,
        allow_suboptions: false,
        tag_name: null,
        tag_color: null,
        start_time: startTime,
        end_time: endTime,
      },
    ];

    electionVoters = [
      { election_id: anonymousElectionId, student_id: voterStudentId, token_used: false },
      { election_id: anonymousElectionId, student_id: secondVoterStudentId, token_used: false },
      { election_id: namedElectionId, student_id: voterStudentId, token_used: false },
      { election_id: closedElectionId, student_id: voterStudentId, token_used: true },
      { election_id: closedElectionId, student_id: secondVoterStudentId, token_used: false },
      { election_id: scheduledElectionId, student_id: voterStudentId, token_used: false },
      { election_id: restrictedElectionId, student_id: secondVoterStudentId, token_used: false },
    ];

    options = [
      {
        id: anonymousOptionOneId,
        election_id: anonymousElectionId,
        parent_option_id: null,
        label: 'Formula Azul',
        option_type: 'ticket',
        image_url: null,
        display_order: 1,
        metadata: null,
      },
      {
        id: anonymousOptionTwoId,
        election_id: anonymousElectionId,
        parent_option_id: null,
        label: 'Formula Verde',
        option_type: 'ticket',
        image_url: null,
        display_order: 2,
        metadata: null,
      },
      {
        id: namedOptionOneId,
        election_id: namedElectionId,
        parent_option_id: null,
        label: 'Aprobar',
        option_type: 'yes_no',
        image_url: null,
        display_order: 1,
        metadata: null,
      },
      {
        id: namedOptionTwoId,
        election_id: namedElectionId,
        parent_option_id: null,
        label: 'Rechazar',
        option_type: 'yes_no',
        image_url: null,
        display_order: 2,
        metadata: null,
      },
      {
        id: closedOptionOneId,
        election_id: closedElectionId,
        parent_option_id: null,
        label: 'Lista Uno',
        option_type: 'ticket',
        image_url: null,
        display_order: 1,
        metadata: null,
      },
      {
        id: closedOptionTwoId,
        election_id: closedElectionId,
        parent_option_id: null,
        label: 'Lista Dos',
        option_type: 'ticket',
        image_url: null,
        display_order: 2,
        metadata: null,
      },
      {
        id: scheduledOptionId,
        election_id: scheduledElectionId,
        parent_option_id: null,
        label: 'Opcion futura',
        option_type: 'ticket',
        image_url: null,
        display_order: 1,
        metadata: null,
      },
    ];

    votingTokens = [];
    votes = [
      {
        id: 'vote-closed-1',
        election_id: closedElectionId,
        option_id: closedOptionOneId,
        parent_option_id: null,
        student_id: voterStudentId,
        token_hash: null,
      },
    ];
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

  function activeStudentById(id: string) {
    return students.find((student) => student.id === id && student.is_active) || null;
  }

  function voterRow(electionId: string, studentId: string) {
    return (
      electionVoters.find(
        (voter) => voter.election_id === electionId && voter.student_id === studentId
      ) || null
    );
  }

  function electionListRow(election: Election, studentId: string) {
    const voter = voterRow(election.id, studentId);
    return {
      ...election,
      has_voted: voter?.token_used ?? false,
      total_options: options.filter(
        (option) => option.election_id === election.id && !option.parent_option_id
      ).length,
    };
  }

  function electionDetailRow(election: Election, studentId: string) {
    const voter = voterRow(election.id, studentId);
    return {
      ...election,
      has_voted: voter?.token_used ?? false,
    };
  }

  function sortedOptionsForElection(electionId: string) {
    return options
      .filter((option) => option.election_id === electionId)
      .sort((left, right) => {
        const leftParent = left.parent_option_id
          ? options.find((option) => option.id === left.parent_option_id)
          : null;
        const rightParent = right.parent_option_id
          ? options.find((option) => option.id === right.parent_option_id)
          : null;
        const parentDiff =
          (leftParent?.display_order ?? left.display_order) -
          (rightParent?.display_order ?? right.display_order);
        if (parentDiff !== 0) return parentDiff;
        if (!left.parent_option_id && right.parent_option_id) return -1;
        if (left.parent_option_id && !right.parent_option_id) return 1;
        return left.display_order - right.display_order;
      });
  }

  function statusRank(status: string) {
    if (status === 'OPEN') return 0;
    if (status === 'CLOSED') return 1;
    if (status === 'SCRUTINIZED') return 2;
    return 3;
  }

  function nextVoteId() {
    return `vote-${String(voteSequence++).padStart(4, '0')}`;
  }

  async function castAnonymousVote(electionId: string, optionId: string, tokenHash: string) {
    const token = votingTokens.find(
      (item) => item.election_id === electionId && item.token_hash === tokenHash && !item.used
    );
    if (!token) {
      throw new Error('token invalido o utilizado');
    }

    const option = options.find((item) => item.id === optionId && item.election_id === electionId);
    if (!option) {
      throw new Error('opcion no encontrada');
    }

    token.used = true;
    const voter = voterRow(electionId, token.student_id);
    if (voter) {
      voter.token_used = true;
    }
    votes.push({
      id: nextVoteId(),
      election_id: electionId,
      option_id: optionId,
      parent_option_id: null,
      student_id: null,
      token_hash: tokenHash,
    });
  }

  async function castNamedVote(electionId: string, optionId: string, studentId: string) {
    const voter = voterRow(electionId, studentId);
    if (!voter || voter.token_used) {
      throw new Error('duplicate key value violates unique constraint');
    }

    const option = options.find((item) => item.id === optionId && item.election_id === electionId);
    if (!option) {
      throw new Error('opcion no encontrada');
    }

    voter.token_used = true;
    votes.push({
      id: nextVoteId(),
      election_id: electionId,
      option_id: optionId,
      parent_option_id: null,
      student_id: studentId,
      token_hash: null,
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

    if (sql.startsWith('SELECT e.*') && sql.includes('WHERE e.id = $1')) {
      const election = electionById(params[0]);
      return { rows: election ? [election] : [], rowCount: election ? 1 : 0 };
    }

    if (sql.startsWith('SELECT e.id') && sql.includes('INNER JOIN election_voters ev') && sql.includes('ORDER BY')) {
      const studentId = String(params[0]);
      const visibleStatuses = ['SCHEDULED', 'OPEN', 'CLOSED', 'SCRUTINIZED', 'ARCHIVED'];
      const rows = electionVoters
        .filter((voter) => voter.student_id === studentId)
        .map((voter) => electionById(voter.election_id))
        .filter((election): election is Election => Boolean(election) && visibleStatuses.includes(election.status))
        .map((election) => electionListRow(election, studentId))
        .sort((left, right) => {
          const statusDiff = statusRank(left.status) - statusRank(right.status);
          if (statusDiff !== 0) return statusDiff;
          return (right.start_time?.getTime() ?? 0) - (left.start_time?.getTime() ?? 0);
        });
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith('SELECT e.id') && sql.includes('INNER JOIN election_voters ev') && sql.includes('WHERE e.id = $1')) {
      const [electionId, studentId] = params as [string, string];
      const election = electionById(electionId);
      const voter = voterRow(electionId, studentId);
      const row = election && voter ? electionDetailRow(election, studentId) : null;
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    if (sql.startsWith('SELECT eo.id') && sql.includes('FROM election_options eo') && !sql.includes('LEFT JOIN votes v')) {
      const rows = sortedOptionsForElection(String(params[0]));
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith('SELECT ev.student_id') && sql.includes('FROM election_voters ev')) {
      const rows = electionVoters
        .filter((voter) => voter.election_id === params[0] && !voter.token_used)
        .map((voter) => activeStudentById(voter.student_id))
        .filter(Boolean)
        .map((student) => ({
          student_id: student!.id,
          carnet: student!.carnet,
          full_name: student!.full_name,
        }))
        .sort((left, right) => left.full_name.localeCompare(right.full_name));
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
          });
          inserted.push({ student_id: studentId });
        }
      });

      return { rows: inserted, rowCount: inserted.length };
    }

    if (sql.startsWith('SELECT token_encrypted FROM voting_tokens')) {
      const token = votingTokens.find(
        (item) => item.election_id === params[0] && item.student_id === params[1] && !item.used
      );
      return {
        rows: token ? [{ token_encrypted: token.token_encrypted }] : [],
        rowCount: token ? 1 : 0,
      };
    }

    if (sql === 'SELECT fn_cast_vote_anonymous($1, $2, $3)') {
      await castAnonymousVote(String(params[0]), String(params[1]), String(params[2]));
      return { rows: [], rowCount: 1 };
    }

    if (sql === 'SELECT fn_cast_vote_named($1, $2, $3)') {
      await castNamedVote(String(params[0]), String(params[1]), String(params[2]));
      return { rows: [], rowCount: 1 };
    }

    if (sql.startsWith('SELECT title, status, allow_suboptions FROM elections WHERE id = $1')) {
      const election = electionById(params[0]);
      return {
        rows: election
          ? [{
              title: election.title,
              status: election.status,
              allow_suboptions: election.allow_suboptions,
            }]
          : [],
        rowCount: election ? 1 : 0,
      };
    }

    if (sql.startsWith('SELECT eo.id') && sql.includes('LEFT JOIN votes v')) {
      const electionId = String(params[0]);
      const rows = sortedOptionsForElection(electionId).map((option) => ({
        id: option.id,
        label: option.label,
        option_type: option.option_type,
        parent_option_id: option.parent_option_id,
        image_url: option.image_url,
        metadata: option.metadata,
        vote_count: String(
          votes.filter(
            (vote) => vote.election_id === electionId && vote.option_id === option.id
          ).length
        ),
      }));
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith('SELECT COUNT(*) AS total, COUNT(*) FILTER')) {
      const voters = electionVoters.filter((voter) => voter.election_id === params[0]);
      return {
        rows: [
          {
            total: String(voters.length),
            voted: String(voters.filter((voter) => voter.token_used).length),
          },
        ],
        rowCount: 1,
      };
    }

    throw new Error(`Unhandled SQL in voting integration test: ${sql}`);
  }

  const query = vi.fn(runQuery);

  resetState();

  return {
    ids: {
      voterStudentId,
      secondVoterStudentId,
      anonymousElectionId,
      namedElectionId,
      closedElectionId,
      scheduledElectionId,
      restrictedElectionId,
      anonymousOptionOneId,
      namedOptionOneId,
      closedOptionOneId,
      scheduledOptionId,
    },
    query,
    resetState,
    getVotingTokens: () => votingTokens,
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

import app from '../../../src/index';

type RequestOptions = {
  token?: string | null;
  body?: unknown;
};

describe('voting integration', () => {
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
      if (token === 'voter-token') {
        return {
          studentId: mockDb.ids.voterStudentId,
          carnet: '2021001234',
          email: 'voter@estudiantec.cr',
          fullName: 'Valeria Votante',
          role: 'voter',
        };
      }

      if (token === 'second-voter-token') {
        return {
          studentId: mockDb.ids.secondVoterStudentId,
          carnet: '2021005678',
          email: 'second@estudiantec.cr',
          fullName: 'Sebastian Votante',
          role: 'voter',
        };
      }

      if (token === 'missing-student-token') {
        return {
          studentId: '99999999-9999-4999-8999-999999999999',
          carnet: '2021999999',
          email: 'missing@estudiantec.cr',
          fullName: 'No Padron',
          role: 'voter',
        };
      }

      throw new Error('invalid token');
    });
  });

  async function request(method: string, path: string, options: RequestOptions = {}) {
    const headers: Record<string, string> = { Accept: 'application/json' };
    const token = options.token === undefined ? 'voter-token' : options.token;

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const body = await response.json();
    return { response, body };
  }

  it('rejects requests without a bearer token', async () => {
    const { response, body } = await request('GET', '/api/voting/elections', { token: null });

    expect(response.status).toBe(401);
    expect(body.error).toContain('Falta el header de');
    expect(body.error).toContain('inv');
  });

  it('returns 404 when the authenticated email is not active in the padron', async () => {
    const { response, body } = await request('GET', '/api/voting/elections', {
      token: 'missing-student-token',
    });

    expect(response.status).toBe(404);
    expect(body).toEqual(
      expect.objectContaining({
        code: 'VOTING_STUDENT_NOT_FOUND',
        error: 'Estudiante no encontrado en el padron',
      })
    );
  });

  it('lists the elections available to the current voter', async () => {
    const { response, body } = await request('GET', '/api/voting/elections');

    expect(response.status).toBe(200);
    expect(body).toHaveLength(4);
    expect(body).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: mockDb.ids.restrictedElectionId,
        }),
      ])
    );
    expect(body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: mockDb.ids.namedElectionId,
        title: 'Consulta nominal',
        status: 'OPEN',
        is_anonymous: false,
        has_voted: false,
        total_options: 2,
      }),
      expect.objectContaining({
        id: mockDb.ids.anonymousElectionId,
        title: 'Eleccion anonima FEITEC',
        status: 'OPEN',
        is_anonymous: true,
        tag_name: 'Computacion',
        total_options: 2,
      }),
      expect.objectContaining({
        id: mockDb.ids.closedElectionId,
        title: 'Resultados publicados',
        status: 'CLOSED',
        has_voted: true,
      }),
      expect.objectContaining({
        id: mockDb.ids.scheduledElectionId,
        title: 'Votacion programada',
        status: 'SCHEDULED',
      }),
    ]));
  });

  it('returns election detail with options and prepares anonymous voting tokens', async () => {
    const { response, body } = await request(
      'GET',
      `/api/voting/elections/${mockDb.ids.anonymousElectionId}`
    );

    expect(response.status).toBe(200);
    expect(body).toEqual(
      expect.objectContaining({
        id: mockDb.ids.anonymousElectionId,
        title: 'Eleccion anonima FEITEC',
        status: 'OPEN',
        is_anonymous: true,
        has_voted: false,
      })
    );
    expect(body.options).toEqual([
      expect.objectContaining({
        id: mockDb.ids.anonymousOptionOneId,
        label: 'Formula Azul',
        display_order: 1,
      }),
      expect.objectContaining({
        label: 'Formula Verde',
        display_order: 2,
      }),
    ]);
    expect(mockDb.getVotingTokens()).toHaveLength(2);
    expect(mockDb.getVotingTokens()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          election_id: mockDb.ids.anonymousElectionId,
          student_id: mockDb.ids.voterStudentId,
          used: false,
        }),
      ])
    );
  });

  it('returns 403 when the voter does not belong to the election', async () => {
    const { response, body } = await request(
      'GET',
      `/api/voting/elections/${mockDb.ids.restrictedElectionId}`
    );

    expect(response.status).toBe(403);
    expect(body).toEqual(
      expect.objectContaining({
        code: 'VOTING_ELECTION_ACCESS_DENIED',
        error: 'No tiene acceso a esta eleccion',
      })
    );
  });

  it('returns 403 when the voter attempts to cast a vote in another voter election', async () => {
    const { response, body } = await request('POST', '/api/voting/cast', {
      body: {
        electionId: mockDb.ids.restrictedElectionId,
        optionId: mockDb.ids.namedOptionOneId,
      },
    });

    expect(response.status).toBe(403);
    expect(body).toEqual(
      expect.objectContaining({
        code: 'VOTING_ELECTION_ACCESS_DENIED',
        error: 'No tiene acceso a esta eleccion',
      })
    );
  });

  it('casts a named vote and rejects a second vote in the same election', async () => {
    const firstVote = await request('POST', '/api/voting/cast', {
      body: {
        electionId: mockDb.ids.namedElectionId,
        optionId: mockDb.ids.namedOptionOneId,
      },
    });
    const secondVote = await request('POST', '/api/voting/cast', {
      body: {
        electionId: mockDb.ids.namedElectionId,
        optionId: mockDb.ids.namedOptionOneId,
      },
    });

    expect(firstVote.response.status).toBe(200);
    expect(firstVote.body).toEqual({
      success: true,
      message: 'Voto emitido exitosamente',
    });
    expect(secondVote.response.status).toBe(409);
    expect(secondVote.body).toEqual(
      expect.objectContaining({
        code: 'VOTING_ALREADY_VOTED',
        error: 'Ya ha emitido su voto en esta eleccion',
      })
    );
  });

  it('casts an anonymous vote with a generated token and marks the token as used', async () => {
    const { response, body } = await request('POST', '/api/voting/cast', {
      body: {
        electionId: mockDb.ids.anonymousElectionId,
        optionId: mockDb.ids.anonymousOptionOneId,
      },
    });

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      message: 'Voto emitido exitosamente',
    });
    expect(mockDb.getVotingTokens()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          election_id: mockDb.ids.anonymousElectionId,
          student_id: mockDb.ids.voterStudentId,
          used: true,
        }),
      ])
    );

    const duplicateVote = await request('POST', '/api/voting/cast', {
      body: {
        electionId: mockDb.ids.anonymousElectionId,
        optionId: mockDb.ids.anonymousOptionOneId,
      },
    });

    expect(duplicateVote.response.status).toBe(409);
    expect(duplicateVote.body).toEqual(
      expect.objectContaining({
        code: 'VOTING_ALREADY_VOTED',
      })
    );
  });

  it('returns 409 when casting a vote for an election that is not open', async () => {
    const { response, body } = await request('POST', '/api/voting/cast', {
      body: {
        electionId: mockDb.ids.scheduledElectionId,
        optionId: mockDb.ids.scheduledOptionId,
      },
    });

    expect(response.status).toBe(409);
    expect(body).toEqual(
      expect.objectContaining({
        code: 'VOTING_NOT_OPEN',
        error: 'La votacion no esta abierta',
      })
    );
  });

  it('returns public results for a closed election', async () => {
    const { response, body } = await request(
      'GET',
      `/api/voting/elections/${mockDb.ids.closedElectionId}/results`
    );

    expect(response.status).toBe(200);
    expect(body).toEqual({
      election_id: mockDb.ids.closedElectionId,
      title: 'Resultados publicados',
      total_votes: 1,
      participation_rate: 50,
      options: [
        {
          id: mockDb.ids.closedOptionOneId,
          label: 'Lista Uno',
          option_type: 'ticket',
          parent_option_id: null,
          image_url: null,
          metadata: null,
          vote_count: 1,
          percentage: 100,
        },
        {
          id: '06060606-0606-4606-8606-060606060606',
          label: 'Lista Dos',
          option_type: 'ticket',
          parent_option_id: null,
          image_url: null,
          metadata: null,
          vote_count: 0,
          percentage: 0,
        },
      ],
    });
  });

  it('returns 403 when requesting results for another voter election', async () => {
    const { response, body } = await request(
      'GET',
      `/api/voting/elections/${mockDb.ids.restrictedElectionId}/results`
    );

    expect(response.status).toBe(403);
    expect(body).toEqual(
      expect.objectContaining({
        code: 'VOTING_ELECTION_ACCESS_DENIED',
        error: 'No tiene acceso a esta eleccion',
      })
    );
  });

  it('returns 409 when public results are requested before they are available', async () => {
    const { response, body } = await request(
      'GET',
      `/api/voting/elections/${mockDb.ids.namedElectionId}/results`
    );

    expect(response.status).toBe(409);
    expect(body).toEqual(
      expect.objectContaining({
        code: 'VOTING_RESULTS_UNAVAILABLE',
        error: 'Los resultados aun no estan disponibles',
      })
    );
  });
});
