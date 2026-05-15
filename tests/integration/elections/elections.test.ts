import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';

const mockAuth = vi.hoisted(() => ({
  verifySessionJWT: vi.fn(),
}));

const mockDb = vi.hoisted(() => {
  const adminStudentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const voterStudentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const secondVoterStudentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const inactiveStudentId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const tagId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const draftElectionId = '11111111-1111-4111-8111-111111111111';
  const scheduledElectionId = '22222222-2222-4222-8222-222222222222';
  const openElectionId = '33333333-3333-4333-8333-333333333333';
  const closedElectionId = '44444444-4444-4444-8444-444444444444';
  const anonymousClosedElectionId = '55555555-5555-4555-8555-555555555555';
  const createdAt = new Date('2026-05-04T12:00:00.000Z');
  const updatedAt = new Date('2026-05-04T12:15:00.000Z');

  type Student = {
    id: string;
    carnet: string;
    full_name: string;
    email: string;
    sede: string;
    career: string;
    degree_level: string;
    is_active: boolean;
  };

  type Admin = {
    id: string;
    students_id: string;
    position_title: string;
    role: string;
    permissions: Record<string, boolean>;
    created_at: Date;
    updated_at: Date;
  };

  type Tag = {
    id: string;
    name: string;
    description: string | null;
    color: string;
    created_by: string | null;
    created_at: Date;
    updated_at: Date;
  };

  type Election = {
    id: string;
    title: string;
    description: string | null;
    status: 'DRAFT' | 'SCHEDULED' | 'OPEN' | 'CLOSED' | 'SCRUTINIZED' | 'ARCHIVED';
    is_anonymous: boolean;
    allow_suboptions: boolean;
    auth_method: 'MICROSOFT';
    voter_source: 'FULL_PADRON' | 'FILTERED' | 'MANUAL' | 'TAG';
    voter_filter: Record<string, unknown> | null;
    tag_id: string | null;
    starts_immediately: boolean;
    immediate_minutes: number | null;
    requires_keys: boolean;
    min_keys: number;
    start_time: Date | null;
    end_time: Date | null;
    created_by: string | null;
    created_at: Date;
    updated_at: Date;
    scrutinized_at?: Date | null;
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

  type ElectionVoter = {
    election_id: string;
    student_id: string;
    token_used: boolean;
  };

  type Vote = {
    id: string;
    election_id: string;
    option_id: string;
    parent_option_id: string | null;
    student_id: string | null;
    created_at: Date;
  };

  type VotingToken = {
    election_id: string;
    student_id: string;
    token_hash: string;
    token_encrypted: string;
    used: boolean;
  };

  let electionSequence = 1;
  let optionSequence = 1;
  let voteSequence = 1;
  let students: Student[] = [];
  let admins: Admin[] = [];
  let tags: Tag[] = [];
  let tagMembers: Array<{ tag_id: string; student_id: string }> = [];
  let elections: Election[] = [];
  let options: ElectionOption[] = [];
  let electionVoters: ElectionVoter[] = [];
  let votes: Vote[] = [];
  let votingTokens: VotingToken[] = [];
  let scrutinyKeys: Array<{ election_id: string; has_submitted: boolean }> = [];
  let lastClient: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> } | null = null;

  function nextElectionId() {
    const suffix = String(electionSequence++).padStart(12, '0');
    return `00000000-0000-4000-8000-${suffix}`;
  }

  function nextOptionId() {
    const suffix = String(optionSequence++).padStart(12, '0');
    return `99999999-9999-4999-8999-${suffix}`;
  }

  function nextVoteId() {
    return `vote-${String(voteSequence++).padStart(4, '0')}`;
  }

  function baseElection(overrides: Partial<Election>): Election {
    return {
      id: '',
      title: '',
      description: null,
      status: 'DRAFT',
      is_anonymous: false,
      allow_suboptions: false,
      auth_method: 'MICROSOFT',
      voter_source: 'FULL_PADRON',
      voter_filter: null,
      tag_id: null,
      starts_immediately: false,
      immediate_minutes: null,
      requires_keys: false,
      min_keys: 1,
      start_time: null,
      end_time: null,
      created_by: null,
      created_at: createdAt,
      updated_at: updatedAt,
      scrutinized_at: null,
      ...overrides,
    };
  }

  function baseOption(overrides: Partial<ElectionOption>): ElectionOption {
    return {
      id: '',
      election_id: '',
      parent_option_id: null,
      label: '',
      option_type: 'ticket',
      image_url: null,
      display_order: 1,
      metadata: null,
      ...overrides,
    };
  }

  function resetState() {
    electionSequence = 1;
    optionSequence = 1;
    voteSequence = 1;
    lastClient = null;

    students = [
      {
        id: adminStudentId,
        carnet: '2020000000',
        full_name: 'Admin TEE',
        email: 'admin@estudiantec.cr',
        sede: 'Central',
        career: 'Administracion',
        degree_level: 'Bachillerato',
        is_active: true,
      },
      {
        id: voterStudentId,
        carnet: '2021001234',
        full_name: 'Ana Garcia',
        email: 'ana@estudiantec.cr',
        sede: 'Central',
        career: 'Ingenieria en Computacion',
        degree_level: 'Bachillerato',
        is_active: true,
      },
      {
        id: secondVoterStudentId,
        carnet: '2021005678',
        full_name: 'Bruno Mora',
        email: 'bruno@estudiantec.cr',
        sede: 'San Carlos',
        career: 'Ingenieria en Produccion Industrial',
        degree_level: 'Licenciatura',
        is_active: true,
      },
      {
        id: inactiveStudentId,
        carnet: '2021009999',
        full_name: 'Carla Inactiva',
        email: 'carla@estudiantec.cr',
        sede: 'Central',
        career: 'Ingenieria en Computacion',
        degree_level: 'Bachillerato',
        is_active: false,
      },
    ];

    admins = [
      {
        id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        students_id: adminStudentId,
        position_title: 'Tribunal Electoral',
        role: 'admin',
        permissions: {},
        created_at: createdAt,
        updated_at: updatedAt,
      },
    ];

    tags = [
      {
        id: tagId,
        name: 'Computacion',
        description: 'Estudiantes de Computacion',
        color: '#283593',
        created_by: adminStudentId,
        created_at: createdAt,
        updated_at: updatedAt,
      },
    ];

    tagMembers = [
      { tag_id: tagId, student_id: voterStudentId },
      { tag_id: tagId, student_id: inactiveStudentId },
    ];

    elections = [
      baseElection({
        id: draftElectionId,
        title: 'Borrador FEITEC',
        description: 'Eleccion aun editable',
        status: 'DRAFT',
        is_anonymous: true,
        voter_source: 'MANUAL',
        created_by: adminStudentId,
      }),
      baseElection({
        id: scheduledElectionId,
        title: 'Eleccion programada',
        description: 'Votacion futura',
        status: 'SCHEDULED',
        voter_source: 'TAG',
        tag_id: tagId,
        start_time: new Date('2099-06-01T12:00:00.000Z'),
        end_time: new Date('2099-06-02T12:00:00.000Z'),
        created_by: adminStudentId,
      }),
      baseElection({
        id: openElectionId,
        title: 'Eleccion abierta',
        description: 'Votacion activa',
        status: 'OPEN',
        voter_source: 'FULL_PADRON',
        start_time: new Date('2026-05-04T10:00:00.000Z'),
        end_time: new Date('2099-05-05T10:00:00.000Z'),
        created_by: adminStudentId,
      }),
      baseElection({
        id: closedElectionId,
        title: 'Eleccion cerrada',
        status: 'CLOSED',
        is_anonymous: false,
        voter_source: 'FULL_PADRON',
        start_time: new Date('2026-05-01T10:00:00.000Z'),
        end_time: new Date('2026-05-02T10:00:00.000Z'),
        created_by: adminStudentId,
      }),
      baseElection({
        id: anonymousClosedElectionId,
        title: 'Eleccion cerrada por papeleta',
        status: 'CLOSED',
        is_anonymous: true,
        voter_source: 'FULL_PADRON',
        start_time: new Date('2026-05-01T10:00:00.000Z'),
        end_time: new Date('2026-05-02T10:00:00.000Z'),
        created_by: adminStudentId,
      }),
    ];

    options = [
      baseOption({ id: 'option-draft-a', election_id: draftElectionId, label: 'Formula Azul', display_order: 1 }),
      baseOption({ id: 'option-draft-b', election_id: draftElectionId, label: 'Formula Verde', display_order: 2 }),
      baseOption({ id: 'option-scheduled-a', election_id: scheduledElectionId, label: 'Lista Norte', display_order: 1 }),
      baseOption({ id: 'option-scheduled-b', election_id: scheduledElectionId, label: 'Lista Sur', display_order: 2 }),
      baseOption({ id: 'option-open-a', election_id: openElectionId, label: 'Aprobar', option_type: 'yes_no', display_order: 1 }),
      baseOption({ id: 'option-open-b', election_id: openElectionId, label: 'Rechazar', option_type: 'yes_no', display_order: 2 }),
      baseOption({ id: 'option-closed-a', election_id: closedElectionId, label: 'Lista Uno', display_order: 1 }),
      baseOption({ id: 'option-closed-b', election_id: closedElectionId, label: 'Lista Dos', display_order: 2 }),
      baseOption({ id: 'option-anon-closed-a', election_id: anonymousClosedElectionId, label: 'Plan Horizonte', display_order: 1 }),
      baseOption({ id: 'option-anon-closed-b', election_id: anonymousClosedElectionId, label: 'Plan Raices', display_order: 2 }),
    ];

    electionVoters = [
      { election_id: draftElectionId, student_id: voterStudentId, token_used: false },
      { election_id: scheduledElectionId, student_id: voterStudentId, token_used: false },
      { election_id: openElectionId, student_id: voterStudentId, token_used: false },
      { election_id: openElectionId, student_id: secondVoterStudentId, token_used: true },
      { election_id: closedElectionId, student_id: voterStudentId, token_used: true },
      { election_id: closedElectionId, student_id: secondVoterStudentId, token_used: false },
      { election_id: anonymousClosedElectionId, student_id: voterStudentId, token_used: true },
      { election_id: anonymousClosedElectionId, student_id: secondVoterStudentId, token_used: false },
    ];

    votes = [
      {
        id: nextVoteId(),
        election_id: openElectionId,
        option_id: 'option-open-b',
        parent_option_id: null,
        student_id: secondVoterStudentId,
        created_at: new Date('2026-05-04T11:20:00.000Z'),
      },
      {
        id: nextVoteId(),
        election_id: closedElectionId,
        option_id: 'option-closed-a',
        parent_option_id: null,
        student_id: voterStudentId,
        created_at: new Date('2026-05-01T11:05:00.000Z'),
      },
      {
        id: nextVoteId(),
        election_id: anonymousClosedElectionId,
        option_id: 'option-anon-closed-a',
        parent_option_id: null,
        student_id: null,
        created_at: new Date('2026-05-01T11:15:00.000Z'),
      },
    ];

    votingTokens = [];
    scrutinyKeys = [];
  }

  function activeStudentById(id: string) {
    return students.find((student) => student.id === id && student.is_active) || null;
  }

  function likeMatches(value: string, pattern: unknown) {
    const normalizedValue = value.trim().toLowerCase();
    const normalizedPattern = String(pattern).trim().toLowerCase();
    if (normalizedPattern.startsWith('%') || normalizedPattern.endsWith('%')) {
      return normalizedValue.includes(normalizedPattern.replace(/%/g, ''));
    }
    return normalizedValue === normalizedPattern;
  }

  function electionById(id: unknown) {
    return elections.find((election) => election.id === id) || null;
  }

  function tagById(id: unknown) {
    return tags.find((tag) => tag.id === id) || null;
  }

  function tagMemberCount(id: string) {
    return tagMembers.filter((member) => member.tag_id === id && activeStudentById(member.student_id)).length;
  }

  function enrichElection(election: Election) {
    const tag = election.tag_id ? tagById(election.tag_id) : null;
    return {
      ...election,
      tag_name: tag?.name ?? null,
      tag_color: tag?.color ?? null,
      tag_description: tag?.description ?? null,
      tag_member_count: tag ? tagMemberCount(tag.id) : 0,
    };
  }

  function electionWithStats(election: Election) {
    const voters = electionVoters.filter((voter) => voter.election_id === election.id);
    return {
      ...enrichElection(election),
      total_voters: voters.length,
      votes_cast: voters.filter((voter) => voter.token_used).length,
      options_count: options.filter(
        (option) => option.election_id === election.id && !option.parent_option_id
      ).length,
    };
  }

  function sortedOptions(electionId: string) {
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

  function addVoter(electionId: string, studentId: string) {
    const exists = electionVoters.some(
      (voter) => voter.election_id === electionId && voter.student_id === studentId
    );
    if (exists) return false;
    electionVoters.push({ election_id: electionId, student_id: studentId, token_used: false });
    return true;
  }

  function parseJsonParam(value: unknown) {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') return value as Record<string, unknown>;
    return JSON.parse(value) as Record<string, unknown>;
  }

  function aggregateOptionResults(electionId: string) {
    return sortedOptions(electionId).map((option) => ({
      id: option.id,
      label: option.label,
      option_type: option.option_type,
      parent_option_id: option.parent_option_id,
      image_url: option.image_url,
      metadata: option.metadata,
      vote_count: String(
        votes.filter((vote) => vote.election_id === electionId && vote.option_id === option.id).length
      ),
    }));
  }

  async function runQuery(sqlInput: string, params: unknown[] = []) {
    const sql = sqlInput.replace(/\s+/g, ' ').trim();

    if (
      sql === 'BEGIN' ||
      sql === 'COMMIT' ||
      sql === 'ROLLBACK' ||
      sql.startsWith('SET LOCAL') ||
      sql.startsWith('SELECT set_config') ||
      sql.startsWith('WITH target AS')
    ) {
      return { rows: [], rowCount: 0 };
    }

    if (sql.startsWith('SELECT * FROM admins WHERE students_id = $1')) {
      const admin = admins.find((item) => item.students_id === params[0]);
      return { rows: admin ? [admin] : [], rowCount: admin ? 1 : 0 };
    }

    if (sql.startsWith('UPDATE elections SET status = CASE')) {
      return { rows: [], rowCount: 0 };
    }

    if (sql.startsWith('SELECT e.*') && sql.includes('ORDER BY e.created_at DESC')) {
      const rows = [...elections]
        .sort((left, right) => right.created_at.getTime() - left.created_at.getTime())
        .map(electionWithStats);
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith('SELECT e.*') && sql.includes('COALESCE(ev.total_voters') && sql.includes('WHERE e.id = $1')) {
      const election = electionById(params[0]);
      return { rows: election ? [electionWithStats(election)] : [], rowCount: election ? 1 : 0 };
    }

    if (sql.startsWith('SELECT e.*') && sql.includes('WHERE e.id = $1')) {
      const election = electionById(params[0]);
      return { rows: election ? [enrichElection(election)] : [], rowCount: election ? 1 : 0 };
    }

    if (sql.startsWith('INSERT INTO elections')) {
      const election = baseElection({
        id: nextElectionId(),
        title: String(params[0]),
        description: (params[1] as string | null) || null,
        status: params[2] as Election['status'],
        is_anonymous: Boolean(params[3]),
        allow_suboptions: Boolean(params[4]),
        auth_method: 'MICROSOFT',
        voter_source: params[6] as Election['voter_source'],
        voter_filter: parseJsonParam(params[7]),
        tag_id: (params[8] as string | null) || null,
        starts_immediately: Boolean(params[9]),
        immediate_minutes: params[10] === null ? null : Number(params[10]),
        requires_keys: Boolean(params[11]),
        min_keys: Number(params[12]),
        start_time: params[13] ? new Date(String(params[13])) : null,
        end_time: params[14] ? new Date(String(params[14])) : null,
        created_by: (params[15] as string | null) || null,
      });
      elections.push(election);
      return { rows: [election], rowCount: 1 };
    }

    if (sql.startsWith('UPDATE elections SET')) {
      const id = params[params.length - 1];
      const election = electionById(id);
      if (!election) return { rows: [], rowCount: 0 };

      let paramIndex = 0;
      if (sql.includes('title = $')) election.title = String(params[paramIndex++]);
      if (sql.includes('description = $')) election.description = (params[paramIndex++] as string | null) || null;
      if (sql.includes('is_anonymous = $')) election.is_anonymous = Boolean(params[paramIndex++]);
      if (sql.includes('allow_suboptions = $')) election.allow_suboptions = Boolean(params[paramIndex++]);
      if (sql.includes('auth_method = $')) {
        params[paramIndex++];
        election.auth_method = 'MICROSOFT';
      }
      if (sql.includes('voter_source = $')) election.voter_source = params[paramIndex++] as Election['voter_source'];
      if (sql.includes('voter_filter = $')) election.voter_filter = parseJsonParam(params[paramIndex++]);
      if (sql.includes('tag_id = $')) election.tag_id = (params[paramIndex++] as string | null) || null;
      if (sql.includes('starts_immediately = $')) election.starts_immediately = Boolean(params[paramIndex++]);
      if (sql.includes('immediate_minutes = $')) {
        const value = params[paramIndex++];
        election.immediate_minutes = value === null ? null : Number(value);
      }
      if (sql.includes('requires_keys = $')) election.requires_keys = Boolean(params[paramIndex++]);
      if (sql.includes('min_keys = $')) election.min_keys = Number(params[paramIndex++]);
      if (sql.includes('status = $')) {
        election.status = params[paramIndex++] as Election['status'];
        if (election.status === 'SCRUTINIZED') {
          election.scrutinized_at = updatedAt;
        }
      }
      if (sql.includes('start_time = $')) {
        const value = params[paramIndex++];
        election.start_time = value ? new Date(String(value)) : null;
      }
      if (sql.includes('end_time = $')) {
        const value = params[paramIndex++];
        election.end_time = value ? new Date(String(value)) : null;
      }
      election.updated_at = updatedAt;

      return { rows: [election], rowCount: 1 };
    }

    if (sql.startsWith('DELETE FROM elections WHERE id = $1')) {
      const before = elections.length;
      elections = elections.filter((election) => election.id !== params[0]);
      options = options.filter((option) => option.election_id !== params[0]);
      electionVoters = electionVoters.filter((voter) => voter.election_id !== params[0]);
      votes = votes.filter((vote) => vote.election_id !== params[0]);
      votingTokens = votingTokens.filter((token) => token.election_id !== params[0]);
      return { rows: [], rowCount: before - elections.length };
    }

    if (sql.startsWith('SELECT eo.*') && sql.includes('FROM election_options eo')) {
      const rows = sortedOptions(String(params[0]));
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith('INSERT INTO election_options')) {
      const option = baseOption({
        id: nextOptionId(),
        election_id: String(params[0]),
        parent_option_id: (params[1] as string | null) || null,
        label: String(params[2]),
        option_type: String(params[3]),
        image_url: (params[4] as string | null) || null,
        display_order: Number(params[5]),
        metadata: parseJsonParam(params[6]),
      });
      options.push(option);
      return { rows: [option], rowCount: 1 };
    }

    if (sql.startsWith('UPDATE election_options SET')) {
      const optionId = params[params.length - 2];
      const electionId = params[params.length - 1];
      const option = options.find((item) => item.id === optionId && item.election_id === electionId);
      if (!option) return { rows: [], rowCount: 0 };

      let paramIndex = 0;
      if (sql.includes('label = $')) option.label = String(params[paramIndex++]);
      if (sql.includes('option_type = $')) option.option_type = String(params[paramIndex++]);
      if (sql.includes('image_url = $')) option.image_url = (params[paramIndex++] as string | null) || null;
      if (sql.includes('display_order = $')) option.display_order = Number(params[paramIndex++]);
      if (sql.includes('metadata = $')) option.metadata = parseJsonParam(params[paramIndex++]);

      return { rows: [option], rowCount: 1 };
    }

    if (sql === 'DELETE FROM election_options WHERE id = $1 AND election_id = $2') {
      const before = options.length;
      const deletedId = params[0];
      options = options.filter(
        (option) =>
          (option.id !== deletedId && option.parent_option_id !== deletedId) ||
          option.election_id !== params[1]
      );
      return { rows: [], rowCount: before - options.length };
    }

    if (sql.startsWith('INSERT INTO election_voters') && sql.includes('SELECT $1, id FROM students')) {
      const electionId = String(params[0]);
      let inserted = 0;
      let filterIndex = 1;
      const sedeFilter = sql.includes('sede ILIKE') ? params[filterIndex++] : undefined;
      const careerFilter = sql.includes('career ILIKE') ? params[filterIndex++] : undefined;

      students.forEach((student) => {
        if (!student.is_active) return;
        if (sedeFilter !== undefined && !likeMatches(student.sede, sedeFilter)) return;
        if (careerFilter !== undefined && !likeMatches(student.career, careerFilter)) return;
        if (addVoter(electionId, student.id)) inserted += 1;
      });
      return { rows: [], rowCount: inserted };
    }

    if (sql.startsWith('INSERT INTO election_voters') && sql.includes('FROM tag_members tm')) {
      const electionId = String(params[0]);
      const members = tagMembers
        .filter((member) => member.tag_id === params[1])
        .map((member) => activeStudentById(member.student_id))
        .filter(Boolean);

      let inserted = 0;
      members.forEach((student) => {
        if (student && addVoter(electionId, student.id)) inserted += 1;
      });
      return { rows: [], rowCount: inserted };
    }

    if (sql.startsWith('INSERT INTO election_voters') && sql.includes('VALUES')) {
      const electionId = String(params[0]);
      let inserted = 0;
      params.slice(1).forEach((studentId) => {
        if (addVoter(electionId, String(studentId))) inserted += 1;
      });
      return { rows: [], rowCount: inserted };
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

    if (sql.startsWith('SELECT COUNT(*)::int AS submitted_keys')) {
      const count = scrutinyKeys.filter(
        (key) => key.election_id === params[0] && key.has_submitted
      ).length;
      return { rows: [{ submitted_keys: count }], rowCount: 1 };
    }

    if (sql === 'DELETE FROM election_voters WHERE election_id = $1') {
      const before = electionVoters.length;
      electionVoters = electionVoters.filter((voter) => voter.election_id !== params[0]);
      return { rows: [], rowCount: before - electionVoters.length };
    }

    if (sql.startsWith('SELECT eo.id') && sql.includes('LEFT JOIN votes v')) {
      const rows = aggregateOptionResults(String(params[0]));
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith('SELECT s.full_name, s.carnet, ev.token_used AS has_voted')) {
      const currentElection = electionById(params[0]);
      const rows = electionVoters
        .filter((voter) => voter.election_id === params[0])
        .map((voter) => {
          const student = activeStudentById(voter.student_id);
          if (!student) return null;

          const selectedVote = votes.find(
            (vote) => vote.election_id === voter.election_id && vote.student_id === voter.student_id
          );
          const selectedOption = selectedVote
            ? options.find((option) => option.id === selectedVote.option_id)
            : null;

          return {
            full_name: student.full_name,
            carnet: student.carnet,
            has_voted: voter.token_used,
            selected_option_label: currentElection?.is_anonymous ? null : selectedOption?.label ?? null,
          };
        })
        .filter(Boolean)
        .sort((left, right) => left!.full_name.localeCompare(right!.full_name));
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith('SELECT date_trunc')) {
      const counts = new Map<string, number>();
      votes
        .filter((vote) => vote.election_id === params[0])
        .forEach((vote) => {
          const hour = new Date(vote.created_at);
          hour.setUTCMinutes(0, 0, 0);
          const key = hour.toISOString();
          counts.set(key, (counts.get(key) || 0) + 1);
        });
      const rows = [...counts.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([hour, count]) => ({ hour: new Date(hour), count }));
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith('SELECT t.id') && sql.includes('FROM tags t') && sql.includes('WHERE t.id = $1')) {
      const tag = tagById(params[0]);
      const row = tag ? { ...tag, member_count: tagMemberCount(tag.id) } : null;
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    if (sql.startsWith('SELECT tm.tag_id') && sql.includes('FROM tag_members tm')) {
      const rows = tagMembers
        .filter((member) => member.tag_id === params[0])
        .map((member) => activeStudentById(member.student_id))
        .filter(Boolean)
        .sort((left, right) => left!.full_name.localeCompare(right!.full_name))
        .map((student) => ({
          tag_id: params[0],
          id: student!.id,
          carnet: student!.carnet,
          full_name: student!.full_name,
          sede: student!.sede,
          career: student!.career,
          degree_level: student!.degree_level,
          is_active: student!.is_active,
        }));
      return { rows, rowCount: rows.length };
    }

    if (sql.startsWith('SELECT ev.student_id') && sql.includes('FROM election_voters ev')) {
      const rows = electionVoters
        .filter((voter) => voter.election_id === params[0] && !voter.token_used)
        .map((voter) => activeStudentById(voter.student_id))
        .filter(Boolean)
        .sort((left, right) => left!.full_name.localeCompare(right!.full_name))
        .map((student) => ({
          student_id: student!.id,
          carnet: student!.carnet,
          full_name: student!.full_name,
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
          });
          inserted.push({ student_id: studentId });
        }
      });

      return { rows: inserted, rowCount: inserted.length };
    }

    throw new Error(`Unhandled SQL in elections integration test: ${sql}`);
  }

  const query = vi.fn(runQuery);
  const connect = vi.fn(async () => {
    const client = {
      query: vi.fn((sql: string, params?: unknown[]) => query(sql, params || [])),
      release: vi.fn(),
    };
    lastClient = client;
    return client;
  });

  resetState();

  return {
    ids: {
      adminStudentId,
      voterStudentId,
      secondVoterStudentId,
      tagId,
      draftElectionId,
      scheduledElectionId,
      openElectionId,
      closedElectionId,
      anonymousClosedElectionId,
    },
    query,
    connect,
    resetState,
    getLastClient: () => lastClient,
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
    connect: mockDb.connect,
    on: vi.fn(),
  },
}));

import app from '../../../src/index';

type RequestOptions = {
  token?: string | null;
  body?: unknown;
};

describe('elections integration', () => {
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
    mockDb.connect.mockClear();
    mockAuth.verifySessionJWT.mockReset();
    mockAuth.verifySessionJWT.mockImplementation((token: string) => {
      if (token === 'admin-token') {
        return {
          studentId: mockDb.ids.adminStudentId,
          carnet: '2020000000',
          email: 'admin@estudiantec.cr',
          fullName: 'Admin TEE',
          role: 'admin',
        };
      }

      if (token === 'voter-token') {
        return {
          studentId: mockDb.ids.voterStudentId,
          carnet: '2021001234',
          email: 'ana@estudiantec.cr',
          fullName: 'Ana Garcia',
          role: 'voter',
        };
      }

      if (token === 'forged-admin-token') {
        return {
          studentId: mockDb.ids.voterStudentId,
          carnet: '2021001234',
          email: 'ana@estudiantec.cr',
          fullName: 'Ana Garcia',
          role: 'admin',
        };
      }

      throw new Error('invalid token');
    });
  });

  async function request(method: string, path: string, options: RequestOptions = {}) {
    const headers: Record<string, string> = { Accept: 'application/json' };
    const token = options.token === undefined ? 'admin-token' : options.token;

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
    const { response, body } = await request('GET', '/api/elections', { token: null });

    expect(response.status).toBe(401);
    expect(body.error).toContain('Falta el header de');
    expect(body.error).toContain('inv');
  });

  it('rejects authenticated users that are not admins', async () => {
    const { response, body } = await request('GET', '/api/elections', { token: 'voter-token' });

    expect(response.status).toBe(403);
    expect(body.error).toBe('Se requieren permisos administrativos para esta accion.');
  });

  it('rejects privilege escalation when a voter forges an admin role in the token', async () => {
    const { response, body } = await request('GET', '/api/elections', {
      token: 'forged-admin-token',
    });

    expect(response.status).toBe(403);
    expect(body.error).toBe('Se requieren permisos administrativos para esta accion.');
    expect(mockDb.query).toHaveBeenCalledWith(
      'SELECT * FROM admins WHERE students_id = $1',
      [mockDb.ids.voterStudentId]
    );
  });

  it('lists elections with stats for an admin user', async () => {
    const { response, body } = await request('GET', '/api/elections');

    expect(response.status).toBe(200);
    expect(body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: mockDb.ids.draftElectionId,
          title: 'Borrador FEITEC',
          status: 'DRAFT',
          options_count: 2,
          total_voters: 1,
        }),
        expect.objectContaining({
          id: mockDb.ids.openElectionId,
          status: 'OPEN',
          votes_cast: 1,
          total_voters: 2,
        }),
      ])
    );
  });

  it('returns an election detail with options and tag summary', async () => {
    const { response, body } = await request(
      'GET',
      `/api/elections/${mockDb.ids.scheduledElectionId}`
    );

    expect(response.status).toBe(200);
    expect(body).toEqual(
      expect.objectContaining({
        id: mockDb.ids.scheduledElectionId,
        title: 'Eleccion programada',
        status: 'SCHEDULED',
        tag_name: 'Computacion',
        tag_color: '#283593',
        tag_member_count: 1,
        total_voters: 1,
        options_count: 2,
      })
    );
    expect(body.options).toEqual([
      expect.objectContaining({ id: 'option-scheduled-a', label: 'Lista Norte', display_order: 1 }),
      expect.objectContaining({ id: 'option-scheduled-b', label: 'Lista Sur', display_order: 2 }),
    ]);
  });

  it('creates a filtered election with options, voters, and audit context', async () => {
    const created = await request('POST', '/api/elections', {
      body: {
        title: '  Consulta   Computacion  ',
        description: 'Eleccion integrada',
        is_anonymous: false,
        voter_source: 'FILTERED',
        voter_filter: { sede: 'Central', career: 'Ingenieria en Computacion' },
        status: 'OPEN',
        options: [
          { label: '  Si  ', option_type: 'yes_no' },
          { label: '  No  ', option_type: 'yes_no' },
        ],
      },
    });

    expect(created.response.status).toBe(201);
    expect(created.body).toEqual(
      expect.objectContaining({
        id: '00000000-0000-4000-8000-000000000001',
        title: '  Consulta   Computacion  ',
        description: 'Eleccion integrada',
        status: 'OPEN',
        voter_source: 'FILTERED',
        created_by: mockDb.ids.adminStudentId,
      })
    );
    expect(mockDb.getLastClient()?.release).toHaveBeenCalledOnce();

    const detail = await request('GET', `/api/elections/${created.body.id}`);
    expect(detail.response.status).toBe(200);
    expect(detail.body.total_voters).toBe(1);
    expect(detail.body.options).toEqual([
      expect.objectContaining({ label: 'Si', display_order: 1 }),
      expect.objectContaining({ label: 'No', display_order: 2 }),
    ]);
  });

  it('returns 400 when publishing without enough options', async () => {
    const { response, body } = await request('POST', '/api/elections', {
      body: {
        title: 'Publicacion incompleta',
        is_anonymous: false,
        voter_source: 'FULL_PADRON',
        status: 'OPEN',
        options: [{ label: 'Unica opcion', option_type: 'ticket' }],
      },
    });

    expect(response.status).toBe(400);
    expect(body).toEqual(
      expect.objectContaining({
        code: 'ELECTION_OPTIONS_REQUIRED_FOR_PUBLICATION',
        error: 'Se necesitan al menos 2 opciones para publicar la votacion',
      })
    );
  });

  it('updates a scheduled election and derives the scheduled status from the new dates', async () => {
    const { response, body } = await request('PUT', `/api/elections/${mockDb.ids.scheduledElectionId}`, {
      body: {
        title: 'Eleccion programada actualizada',
        requires_keys: true,
        min_keys: 2,
        start_time: '2099-07-01T12:00:00.000Z',
        end_time: '2099-07-02T12:00:00.000Z',
      },
    });

    expect(response.status).toBe(200);
    expect(body).toEqual(
      expect.objectContaining({
        id: mockDb.ids.scheduledElectionId,
        title: 'Eleccion programada actualizada',
        status: 'SCHEDULED',
        requires_keys: true,
        min_keys: 2,
      })
    );
  });

  it('deletes an election and returns 404 when it is requested again', async () => {
    const deleted = await request('DELETE', `/api/elections/${mockDb.ids.draftElectionId}`);
    const fetched = await request('GET', `/api/elections/${mockDb.ids.draftElectionId}`);

    expect(deleted.response.status).toBe(200);
    expect(deleted.body).toEqual({ success: true });
    expect(fetched.response.status).toBe(404);
    expect(fetched.body).toEqual(
      expect.objectContaining({
        code: 'ELECTION_NOT_FOUND',
      })
    );
  });

  it('opens a draft anonymous election and prepares voting tokens', async () => {
    const { response, body } = await request('PUT', `/api/elections/${mockDb.ids.draftElectionId}/status`, {
      body: { status: 'OPEN' },
    });

    expect(response.status).toBe(200);
    expect(body).toEqual(
      expect.objectContaining({
        id: mockDb.ids.draftElectionId,
        status: 'OPEN',
        is_anonymous: true,
      })
    );
    expect(mockDb.getVotingTokens()).toEqual([
      expect.objectContaining({
        election_id: mockDb.ids.draftElectionId,
        student_id: mockDb.ids.voterStudentId,
        used: false,
      }),
    ]);
  });

  it('returns 400 for an invalid status transition', async () => {
    const { response, body } = await request('PUT', `/api/elections/${mockDb.ids.openElectionId}/status`, {
      body: { status: 'DRAFT' },
    });

    expect(response.status).toBe(400);
    expect(body).toEqual(
      expect.objectContaining({
        code: 'ELECTION_INVALID_STATUS_TRANSITION',
        error: 'No se puede cambiar de OPEN a DRAFT',
      })
    );
  });

  it('adds, updates, and deletes options while the election is editable', async () => {
    const created = await request('POST', `/api/elections/${mockDb.ids.draftElectionId}/options`, {
      body: { label: 'Abstencion', option_type: 'blank', display_order: 3 },
    });
    const updated = await request(
      'PUT',
      `/api/elections/${mockDb.ids.draftElectionId}/options/${created.body.id}`,
      { body: { label: 'Abstencion actualizada', description: 'Voto en blanco' } }
    );
    const deleted = await request(
      'DELETE',
      `/api/elections/${mockDb.ids.draftElectionId}/options/${created.body.id}`
    );

    expect(created.response.status).toBe(201);
    expect(created.body).toEqual(expect.objectContaining({ label: 'Abstencion', display_order: 3 }));
    expect(updated.response.status).toBe(200);
    expect(updated.body).toEqual(
      expect.objectContaining({
        label: 'Abstencion actualizada',
        metadata: { description: 'Voto en blanco' },
      })
    );
    expect(deleted.response.status).toBe(200);
    expect(deleted.body).toEqual({ success: true });
  });

  it('populates and clears voters for an editable election', async () => {
    const populated = await request('POST', `/api/elections/${mockDb.ids.draftElectionId}/voters/populate`, {
      body: { student_ids: [mockDb.ids.secondVoterStudentId] },
    });
    const cleared = await request('DELETE', `/api/elections/${mockDb.ids.draftElectionId}/voters`);

    expect(populated.response.status).toBe(200);
    expect(populated.body).toEqual({ added: 1, total: 2 });
    expect(cleared.response.status).toBe(200);
    expect(cleared.body).toEqual({ success: true });
  });

  it('returns results for a closed election with named voter details', async () => {
    const { response, body } = await request('GET', `/api/elections/${mockDb.ids.closedElectionId}/results`);

    expect(response.status).toBe(200);
    expect(body).toEqual(
      expect.objectContaining({
        total_votes: 1,
        total_eligible: 2,
        participation_rate: 50,
        voters: [
          {
            full_name: 'Ana Garcia',
            carnet: '2021001234',
            has_voted: true,
            selected_option_label: 'Lista Uno',
          },
          {
            full_name: 'Bruno Mora',
            carnet: '2021005678',
            has_voted: false,
            selected_option_label: null,
          },
        ],
      })
    );
    expect(body.options).toEqual([
      expect.objectContaining({ id: 'option-closed-a', vote_count: 1, percentage: 100 }),
      expect.objectContaining({ id: 'option-closed-b', vote_count: 0, percentage: 0 }),
    ]);
  });

  it('returns results for a ballot election with participation detail and no selected option disclosure', async () => {
    const { response, body } = await request('GET', `/api/elections/${mockDb.ids.anonymousClosedElectionId}/results`);

    expect(response.status).toBe(200);
    expect(body).toEqual(
      expect.objectContaining({
        total_votes: 1,
        total_eligible: 2,
        participation_rate: 50,
        voters: [
          {
            full_name: 'Ana Garcia',
            carnet: '2021001234',
            has_voted: true,
            selected_option_label: null,
          },
          {
            full_name: 'Bruno Mora',
            carnet: '2021005678',
            has_voted: false,
            selected_option_label: null,
          },
        ],
      })
    );
    expect(body.options).toEqual([
      expect.objectContaining({ id: 'option-anon-closed-a', vote_count: 1, percentage: 100 }),
      expect.objectContaining({ id: 'option-anon-closed-b', vote_count: 0, percentage: 0 }),
    ]);
  });

  it('returns 409 when results are requested before the election closes', async () => {
    const { response, body } = await request('GET', `/api/elections/${mockDb.ids.openElectionId}/results`);

    expect(response.status).toBe(409);
    expect(body).toEqual(
      expect.objectContaining({
        code: 'ELECTION_RESULTS_NOT_CLOSED',
      })
    );
  });

  it('returns hourly monitoring data for active elections', async () => {
    const { response, body } = await request('GET', `/api/elections/${mockDb.ids.openElectionId}/monitoring`);

    expect(response.status).toBe(200);
    expect(body).toEqual({
      votesByHour: [{ hour: '2026-05-04T11:00:00.000Z', count: 1 }],
    });
  });
});
