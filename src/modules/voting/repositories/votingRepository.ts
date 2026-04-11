import { Pool, PoolClient } from 'pg';
import { pool } from '../../../config/database';
import { VoterElection, VoteOption } from '../models/votingModel';

type Queryable = Pool | PoolClient;

// Get elections where the student is an eligible voter
export async function findElectionsForVoter(studentId: string): Promise<VoterElection[]> {
  const result = await pool.query<VoterElection>(`
    SELECT
      e.id, e.title, e.description, e.status,
      e.is_anonymous, e.start_time, e.end_time,
      ev.token_used AS has_voted,
      (SELECT COUNT(*)::int FROM election_options eo WHERE eo.election_id = e.id) AS total_options
    FROM elections e
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

// Get election detail for voting (only if voter is eligible and election is OPEN)
export async function findElectionForVoting(electionId: string, studentId: string): Promise<{
  id: string;
  title: string;
  description: string | null;
  status: string;
  is_anonymous: boolean;
  start_time: Date | null;
  end_time: Date | null;
  has_voted: boolean;
} | null> {
  const result = await pool.query(`
    SELECT
      e.id, e.title, e.description, e.status,
      e.is_anonymous, e.start_time, e.end_time,
      ev.token_used AS has_voted
    FROM elections e
    INNER JOIN election_voters ev ON ev.election_id = e.id AND ev.student_id = $2
    WHERE e.id = $1
  `, [electionId, studentId]);
  return result.rows[0] || null;
}

export async function findElectionOptions(electionId: string): Promise<VoteOption[]> {
  const result = await pool.query<VoteOption>(
    'SELECT id, label, option_type, display_order FROM election_options WHERE election_id = $1 ORDER BY display_order ASC',
    [electionId]
  );
  return result.rows;
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

// Get results for voter view
export async function getPublicResults(electionId: string): Promise<{
  title: string;
  options: Array<{ label: string; option_type: string; vote_count: number }>;
  total_eligible: number;
  total_voted: number;
} | null> {
  const electionResult = await pool.query<{ title: string; status: string }>(
    'SELECT title, status FROM elections WHERE id = $1',
    [electionId]
  );
  if (!electionResult.rows[0]) return null;
  if (!['CLOSED', 'SCRUTINIZED', 'ARCHIVED'].includes(electionResult.rows[0].status)) return null;

  const optionsResult = await pool.query<{ label: string; option_type: string; vote_count: string }>(`
    SELECT eo.label, eo.option_type, COUNT(v.id)::text AS vote_count
    FROM election_options eo
    LEFT JOIN votes v ON v.option_id = eo.id AND v.election_id = eo.election_id
    WHERE eo.election_id = $1
    GROUP BY eo.id, eo.label, eo.option_type, eo.display_order
    ORDER BY eo.display_order ASC
  `, [electionId]);

  const voterResult = await pool.query<{ total: string; voted: string }>(`
    SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE token_used = true) AS voted
    FROM election_voters WHERE election_id = $1
  `, [electionId]);

  return {
    title: electionResult.rows[0].title,
    options: optionsResult.rows.map(r => ({
      label: r.label,
      option_type: r.option_type,
      vote_count: parseInt(r.vote_count, 10),
    })),
    total_eligible: parseInt(voterResult.rows[0].total, 10),
    total_voted: parseInt(voterResult.rows[0].voted, 10),
  };
}
