import { pool } from '../../../config/database';
import { VoterElection, VoteOption } from '../models/votingModel';

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

// Get student ID from email
export async function findStudentIdByEmail(email: string): Promise<string | null> {
  const result = await pool.query<{ id: string }>(
    'SELECT id FROM students WHERE email = $1 AND is_active = true',
    [email]
  );
  return result.rows[0]?.id || null;
}

// Store vote token hash for anonymous election
export async function storeVoteToken(electionId: string, studentId: string, tokenHash: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE election_voters
     SET vote_token_hash = $3
     WHERE election_id = $1 AND student_id = $2 AND token_used = false AND vote_token_hash IS NULL`,
    [electionId, studentId, tokenHash]
  );
  return (result.rowCount ?? 0) > 0;
}

// Check if voter already has a token
export async function getVoterStatus(electionId: string, studentId: string): Promise<{
  token_used: boolean;
  has_token: boolean;
} | null> {
  const result = await pool.query<{ token_used: boolean; vote_token_hash: string | null }>(
    'SELECT token_used, vote_token_hash FROM election_voters WHERE election_id = $1 AND student_id = $2',
    [electionId, studentId]
  );
  if (!result.rows[0]) return null;
  return {
    token_used: result.rows[0].token_used,
    has_token: result.rows[0].vote_token_hash !== null,
  };
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
