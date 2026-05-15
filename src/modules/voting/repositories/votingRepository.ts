import { Pool, PoolClient } from 'pg';
import { pool } from '../../../config/database';
import { PublicResultOption, VoterElection, VoteOption, VoteSelectionDto } from '../models/votingModel';

type Queryable = Pool | PoolClient;

function nestVoteOptions<T extends VoteOption>(rows: T[]): T[] {
  const parents = rows
    .filter((option) => !option.parent_option_id)
    .map((option) => ({ ...option, suboptions: [] as T[] }));
  const parentMap = new Map(parents.map((option) => [option.id, option]));

  rows
    .filter((option) => option.parent_option_id)
    .forEach((option) => {
      const parent = option.parent_option_id ? parentMap.get(option.parent_option_id) : undefined;
      if (parent) {
        parent.suboptions?.push({ ...option, suboptions: [] as T[] });
      }
    });

  return parents as T[];
}

function nestPublicResultOptions(rows: PublicResultOption[]): PublicResultOption[] {
  const parents = rows
    .filter((option) => !option.parent_option_id)
    .map((option) => ({ ...option, suboptions: [] as PublicResultOption[] }));
  const parentMap = new Map(parents.map((option) => [option.id, option]));

  rows
    .filter((option) => option.parent_option_id)
    .forEach((option) => {
      const parent = option.parent_option_id ? parentMap.get(option.parent_option_id) : undefined;
      if (parent) {
        parent.suboptions?.push({ ...option, suboptions: [] });
      }
    });

  return parents;
}

export async function findElectionsForVoter(studentId: string): Promise<VoterElection[]> {
  const result = await pool.query<VoterElection>(`
    SELECT
      e.id, e.title, e.description, e.status,
      e.is_anonymous, e.allow_suboptions, t.name AS tag_name, t.color AS tag_color, e.start_time, e.end_time,
      ev.token_used AS has_voted,
      (SELECT COUNT(*)::int FROM election_options eo WHERE eo.election_id = e.id AND eo.parent_option_id IS NULL) AS total_options
    FROM elections e
    LEFT JOIN tags t ON t.id = e.tag_id
    INNER JOIN election_voters ev ON ev.election_id = e.id AND ev.student_id = $1
    WHERE e.status IN ('SCHEDULED', 'OPEN', 'CLOSED', 'SCRUTINIZED', 'ARCHIVED')
    ORDER BY
      CASE e.status
        WHEN 'OPEN' THEN 0
        WHEN 'CLOSED' THEN 1
        WHEN 'SCRUTINIZED' THEN 2
        ELSE 3
      END,
      e.start_time DESC NULLS LAST
  `, [studentId]);
  return result.rows;
}

export async function findElectionForVoting(electionId: string, studentId: string): Promise<{
  id: string;
  title: string;
  description: string | null;
  status: string;
  is_anonymous: boolean;
  tag_name: string | null;
  tag_color: string | null;
  start_time: Date | null;
  end_time: Date | null;
  has_voted: boolean;
  allow_suboptions: boolean;
} | null> {
  const result = await pool.query(`
    SELECT
      e.id, e.title, e.description, e.status,
      e.is_anonymous, e.allow_suboptions, t.name AS tag_name, t.color AS tag_color, e.start_time, e.end_time,
      ev.token_used AS has_voted
    FROM elections e
    LEFT JOIN tags t ON t.id = e.tag_id
    INNER JOIN election_voters ev ON ev.election_id = e.id AND ev.student_id = $2
    WHERE e.id = $1
  `, [electionId, studentId]);
  return result.rows[0] || null;
}

export async function findElectionOptions(electionId: string): Promise<VoteOption[]> {
  const result = await pool.query<VoteOption>(
    `SELECT eo.id, eo.election_id, eo.parent_option_id, eo.label, eo.option_type, eo.image_url, eo.display_order, eo.metadata
     FROM election_options eo
     LEFT JOIN election_options parent ON parent.id = eo.parent_option_id
     WHERE eo.election_id = $1
     ORDER BY COALESCE(parent.display_order, eo.display_order) ASC,
       CASE WHEN eo.parent_option_id IS NULL THEN 0 ELSE 1 END ASC,
       eo.display_order ASC`,
    [electionId]
  );
  return nestVoteOptions(result.rows);
}

export async function findStudentIdentityByEmail(email: string): Promise<{
  id: string;
  carnet: string;
  full_name: string;
} | null> {
  const result = await pool.query<{
    id: string;
    carnet: string;
    full_name: string;
  }>(
    'SELECT id, carnet, full_name FROM students WHERE email = $1 AND is_active = true',
    [email]
  );
  return result.rows[0] || null;
}

export async function listPendingAnonymousVoters(
  electionId: string,
  db: Queryable = pool
): Promise<Array<{
  student_id: string;
  carnet: string;
  full_name: string;
}>> {
  const result = await db.query<{
    student_id: string;
    carnet: string;
    full_name: string;
  }>(
    `SELECT
       ev.student_id,
       s.carnet,
       s.full_name
     FROM election_voters ev
     INNER JOIN students s ON s.id = ev.student_id
     WHERE ev.election_id = $1
       AND ev.token_used = false
       AND s.is_active = true
     ORDER BY s.full_name ASC`,
    [electionId]
  );

  return result.rows;
}

export async function insertMissingVotingTokens(
  rows: Array<{
    election_id: string;
    student_id: string;
    token_hash: string;
    token_encrypted: string;
  }>,
  db: Queryable = pool
): Promise<string[]> {
  if (rows.length === 0) {
    return [];
  }

  const electionIds = rows.map((row) => row.election_id);
  const studentIds = rows.map((row) => row.student_id);
  const tokenHashes = rows.map((row) => row.token_hash);
  const encryptedTokens = rows.map((row) => row.token_encrypted);

  const result = await db.query<{ student_id: string }>(
    `INSERT INTO voting_tokens (election_id, student_id, token_hash, token_encrypted)
     SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::text[])
     ON CONFLICT (election_id, student_id) DO NOTHING
     RETURNING student_id`,
    [electionIds, studentIds, tokenHashes, encryptedTokens]
  );

  return result.rows.map((row) => row.student_id);
}

export async function upsertVotingTokens(
  rows: Array<{
    election_id: string;
    student_id: string;
    token_hash: string;
    token_encrypted: string;
  }>,
  db: Queryable = pool
): Promise<string[]> {
  if (rows.length === 0) {
    return [];
  }

  const electionIds = rows.map((row) => row.election_id);
  const studentIds = rows.map((row) => row.student_id);
  const tokenHashes = rows.map((row) => row.token_hash);
  const encryptedTokens = rows.map((row) => row.token_encrypted);

  const result = await db.query<{ student_id: string }>(
    `INSERT INTO voting_tokens (election_id, student_id, token_hash, token_encrypted)
     SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::text[])
     ON CONFLICT (election_id, student_id) DO UPDATE
       SET token_hash = EXCLUDED.token_hash,
           token_encrypted = EXCLUDED.token_encrypted,
           generated_at = now(),
           used = false,
           used_at = NULL
     WHERE voting_tokens.used = false
     RETURNING student_id`,
    [electionIds, studentIds, tokenHashes, encryptedTokens]
  );

  return result.rows.map((row) => row.student_id);
}

export async function findVotingTokenByStudent(
  electionId: string,
  studentId: string
): Promise<{ token_encrypted: string } | null> {
  const result = await pool.query<{ token_encrypted: string }>(
    `SELECT token_encrypted
     FROM voting_tokens
     WHERE election_id = $1
       AND student_id = $2
       AND used = false`,
    [electionId, studentId]
  );
  return result.rows[0] || null;
}

// Cast anonymous vote using DB function
export async function castAnonymousVote(electionId: string, optionId: string, tokenHash: string): Promise<void> {
  await pool.query(
    'SELECT fn_cast_vote_anonymous($1, $2, $3)',
    [electionId, optionId, tokenHash]
  );
}

// Cast non-anonymous vote using DB function
export async function castNamedVote(electionId: string, optionId: string, studentId: string): Promise<void> {
  await pool.query(
    'SELECT fn_cast_vote_named($1, $2, $3)',
    [electionId, optionId, studentId]
  );
}

export async function castAnonymousSuboptionVotes(
  electionId: string,
  selections: VoteSelectionDto[],
  tokenHash: string
): Promise<void> {
  await pool.query(
    'SELECT fn_cast_suboption_votes_anonymous($1, $2::jsonb, $3)',
    [electionId, JSON.stringify(selections), tokenHash]
  );
}

export async function castNamedSuboptionVotes(
  electionId: string,
  selections: VoteSelectionDto[],
  studentId: string
): Promise<void> {
  await pool.query(
    'SELECT fn_cast_suboption_votes_named($1, $2::jsonb, $3)',
    [electionId, JSON.stringify(selections), studentId]
  );
}

// Get results for voter view
export async function getPublicResults(electionId: string): Promise<{
  title: string;
  allow_suboptions: boolean;
  options: PublicResultOption[];
  total_eligible: number;
  total_voted: number;
} | null> {
  const electionResult = await pool.query<{ title: string; status: string; allow_suboptions: boolean }>(
    'SELECT title, status, allow_suboptions FROM elections WHERE id = $1',
    [electionId]
  );
  if (!electionResult.rows[0]) return null;
  if (!['CLOSED', 'SCRUTINIZED', 'ARCHIVED'].includes(electionResult.rows[0].status)) return null;

  const optionsResult = await pool.query<{
    id: string;
    label: string;
    option_type: string;
    parent_option_id: string | null;
    image_url: string | null;
    metadata: Record<string, unknown> | null;
    vote_count: number | string;
  }>(`
    SELECT eo.id, eo.label, eo.option_type, eo.parent_option_id, eo.image_url, eo.metadata,
      COUNT(v.id)::int AS vote_count
    FROM election_options eo
    LEFT JOIN election_options parent ON parent.id = eo.parent_option_id
    LEFT JOIN votes v ON v.option_id = eo.id AND v.election_id = eo.election_id
    WHERE eo.election_id = $1
    GROUP BY eo.id, eo.label, eo.option_type, eo.parent_option_id, eo.image_url, eo.metadata,
      eo.display_order, parent.display_order
    ORDER BY COALESCE(parent.display_order, eo.display_order) ASC,
      CASE WHEN eo.parent_option_id IS NULL THEN 0 ELSE 1 END ASC,
      eo.display_order ASC
  `, [electionId]);

  const voterResult = await pool.query<{ total: string; voted: string }>(`
    SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE token_used = true) AS voted
    FROM election_voters WHERE election_id = $1
  `, [electionId]);

  const flatOptions: PublicResultOption[] = optionsResult.rows.map((row) => ({
    id: row.id,
    label: row.label,
    option_type: row.option_type,
    parent_option_id: row.parent_option_id,
    image_url: row.image_url,
    metadata: row.metadata,
    vote_count: Number(row.vote_count),
  }));
  const options = electionResult.rows[0].allow_suboptions
    ? nestPublicResultOptions(flatOptions).map((parent) => {
        const suboptions = parent.suboptions ?? [];
        const parentTotal = suboptions.reduce((acc, option) => acc + option.vote_count, 0);
        return {
          ...parent,
          vote_count: parentTotal,
          suboptions: suboptions.map((option) => ({
            ...option,
            percentage: parentTotal > 0 ? (option.vote_count / parentTotal) * 100 : 0,
          })),
        };
      })
    : flatOptions.filter((option) => !option.parent_option_id);

  return {
    title: electionResult.rows[0].title,
    allow_suboptions: electionResult.rows[0].allow_suboptions,
    options,
    total_eligible: parseInt(voterResult.rows[0].total, 10),
    total_voted: parseInt(voterResult.rows[0].voted, 10),
  };
}
