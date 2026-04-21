import { pool } from '../../../config/database';
import { Pool, PoolClient } from 'pg';
import {
  Election,
  ElectionOption,
  ElectionWithStats,
  CreateElectionDto,
  UpdateElectionDto,
  CreateOptionDto,
  UpdateOptionDto,
  ElectionResults,
  VotesByHour,
  MonitoringData
} from '../models/electionModel';

type Queryable = Pool | PoolClient;

function withOptionMetadata(
  description?: string,
  metadata?: Record<string, unknown>
): Record<string, unknown> | null {
  const nextMetadata = { ...(metadata || {}) };

  if (description !== undefined) {
    nextMetadata.description = description;
  }

  return Object.keys(nextMetadata).length > 0 ? nextMetadata : null;
}

export async function syncAutomaticStatuses(db: Queryable = pool): Promise<void> {
  await db.query(
    `UPDATE elections
     SET status = CASE
       WHEN end_time IS NOT NULL AND end_time <= now() THEN 'CLOSED'::election_status
       WHEN (start_time IS NULL OR start_time <= now()) AND (end_time IS NULL OR end_time > now()) THEN 'OPEN'::election_status
       WHEN start_time > now() THEN 'SCHEDULED'::election_status
       ELSE status
     END
     WHERE status IN ('SCHEDULED', 'OPEN')
       AND (
         (end_time IS NOT NULL AND end_time <= now() AND status <> 'CLOSED')
         OR ((start_time IS NULL OR start_time <= now()) AND (end_time IS NULL OR end_time > now()) AND status <> 'OPEN')
         OR (start_time > now() AND status <> 'SCHEDULED')
       )`
  );
}

export async function findAllElections(): Promise<ElectionWithStats[]> {
  const result = await pool.query<ElectionWithStats>(`
    SELECT e.*,
      t.name AS tag_name,
      t.description AS tag_description,
      COALESCE(tag_stats.member_count, 0)::int AS tag_member_count,
      COALESCE(ev.total_voters, 0)::int AS total_voters,
      COALESCE(ev.votes_cast, 0)::int AS votes_cast,
      COALESCE(eo.options_count, 0)::int AS options_count
    FROM elections e
    LEFT JOIN tags t ON t.id = e.tag_id
    LEFT JOIN (
      SELECT tag_id, COUNT(*) AS member_count
      FROM tag_members
      GROUP BY tag_id
    ) tag_stats ON tag_stats.tag_id = t.id
    LEFT JOIN (
      SELECT election_id,
        COUNT(*) AS total_voters,
        COUNT(*) FILTER (WHERE token_used = true) AS votes_cast
      FROM election_voters
      GROUP BY election_id
    ) ev ON ev.election_id = e.id
    LEFT JOIN (
      SELECT election_id, COUNT(*) AS options_count
      FROM election_options
      GROUP BY election_id
    ) eo ON eo.election_id = e.id
    ORDER BY e.created_at DESC
  `);
  return result.rows;
}

export async function findElectionById(id: string): Promise<Election | null> {
  const result = await pool.query<Election>(
    `SELECT e.*,
      t.name AS tag_name,
      t.description AS tag_description,
      COALESCE(tag_stats.member_count, 0)::int AS tag_member_count
     FROM elections e
     LEFT JOIN tags t ON t.id = e.tag_id
     LEFT JOIN (
       SELECT tag_id, COUNT(*) AS member_count
       FROM tag_members
       GROUP BY tag_id
     ) tag_stats ON tag_stats.tag_id = t.id
     WHERE e.id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

export async function findElectionWithStats(id: string): Promise<ElectionWithStats | null> {
  const result = await pool.query<ElectionWithStats>(`
    SELECT e.*,
      t.name AS tag_name,
      t.description AS tag_description,
      COALESCE(tag_stats.member_count, 0)::int AS tag_member_count,
      COALESCE(ev.total_voters, 0)::int AS total_voters,
      COALESCE(ev.votes_cast, 0)::int AS votes_cast,
      COALESCE(eo.options_count, 0)::int AS options_count
    FROM elections e
    LEFT JOIN tags t ON t.id = e.tag_id
    LEFT JOIN (
      SELECT tag_id, COUNT(*) AS member_count
      FROM tag_members
      GROUP BY tag_id
    ) tag_stats ON tag_stats.tag_id = t.id
    LEFT JOIN (
      SELECT election_id,
        COUNT(*) AS total_voters,
        COUNT(*) FILTER (WHERE token_used = true) AS votes_cast
      FROM election_voters
      GROUP BY election_id
    ) ev ON ev.election_id = e.id
    LEFT JOIN (
      SELECT election_id, COUNT(*) AS options_count
      FROM election_options
      GROUP BY election_id
    ) eo ON eo.election_id = e.id
    WHERE e.id = $1
  `, [id]);
  return result.rows[0] || null;
}

export async function createElection(data: CreateElectionDto, createdBy?: string): Promise<Election> {
  const status = data.status || 'DRAFT';
  const result = await pool.query<Election>(
    `INSERT INTO elections (title, description, status, is_anonymous, auth_method, voter_source, voter_filter, tag_id, starts_immediately, immediate_minutes, start_time, end_time, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      data.title,
      data.description || null,
      status,
      data.is_anonymous,
      data.auth_method || 'MICROSOFT',
      data.voter_source,
      data.voter_filter ? JSON.stringify(data.voter_filter) : null,
      data.tag_id || null,
      data.starts_immediately || false,
      data.immediate_minutes ?? null,
      data.start_time || null,
      data.end_time || null,
      createdBy || null,
    ]
  );
  return result.rows[0];
}

export async function updateElection(id: string, data: UpdateElectionDto, db: Queryable = pool): Promise<Election | null> {
  const fields: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (data.title !== undefined) { fields.push(`title = $${idx++}`); params.push(data.title); }
  if (data.description !== undefined) { fields.push(`description = $${idx++}`); params.push(data.description); }
  if (data.is_anonymous !== undefined) { fields.push(`is_anonymous = $${idx++}`); params.push(data.is_anonymous); }
  if (data.auth_method !== undefined) { fields.push(`auth_method = $${idx++}`); params.push(data.auth_method); }
  if (data.voter_source !== undefined) { fields.push(`voter_source = $${idx++}`); params.push(data.voter_source); }
  if (data.voter_filter !== undefined) { fields.push(`voter_filter = $${idx++}`); params.push(JSON.stringify(data.voter_filter)); }
  if (data.tag_id !== undefined) { fields.push(`tag_id = $${idx++}`); params.push(data.tag_id); }
  if (data.starts_immediately !== undefined) { fields.push(`starts_immediately = $${idx++}`); params.push(data.starts_immediately); }
  if (data.immediate_minutes !== undefined) { fields.push(`immediate_minutes = $${idx++}`); params.push(data.immediate_minutes); }
  if (data.status !== undefined) { fields.push(`status = $${idx++}`); params.push(data.status); }
  if (data.start_time !== undefined) { fields.push(`start_time = $${idx++}`); params.push(data.start_time); }
  if (data.end_time !== undefined) { fields.push(`end_time = $${idx++}`); params.push(data.end_time); }

  if (fields.length === 0) return findElectionById(id);

  const result = await db.query<Election>(
    `UPDATE elections SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    [...params, id]
  );
  return result.rows[0] || null;
}

export async function deleteElection(id: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM elections WHERE id = $1 AND status = 'DRAFT'`,
    [id]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function updateElectionStatus(id: string, status: Election['status'], db: Queryable = pool): Promise<Election | null> {
  const result = await db.query<Election>(
    'UPDATE elections SET status = $1 WHERE id = $2 RETURNING *',
    [status, id]
  );
  return result.rows[0] || null;
}

// ── Options ──

export async function findOptionsByElection(electionId: string): Promise<ElectionOption[]> {
  const result = await pool.query<ElectionOption>(
    'SELECT * FROM election_options WHERE election_id = $1 ORDER BY display_order ASC',
    [electionId]
  );
  return result.rows;
}

export async function createOption(electionId: string, data: CreateOptionDto): Promise<ElectionOption> {
  const metadata = withOptionMetadata(data.description, data.metadata);
  const result = await pool.query<ElectionOption>(
    `INSERT INTO election_options (election_id, label, option_type, display_order, metadata)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [electionId, data.label, data.option_type, data.display_order || 0, metadata ? JSON.stringify(metadata) : null]
  );
  return result.rows[0];
}

export async function updateOption(
  electionId: string,
  optionId: string,
  data: UpdateOptionDto,
  db: Queryable = pool
): Promise<ElectionOption | null> {
  const fields: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (data.label !== undefined) { fields.push(`label = $${idx++}`); params.push(data.label); }
  if (data.option_type !== undefined) { fields.push(`option_type = $${idx++}`); params.push(data.option_type); }
  if (data.display_order !== undefined) { fields.push(`display_order = $${idx++}`); params.push(data.display_order); }
  if (data.metadata !== undefined || data.description !== undefined) {
    fields.push(`metadata = $${idx++}`);
    params.push(JSON.stringify(withOptionMetadata(data.description, data.metadata)));
  }

  if (fields.length === 0) return null;

  const result = await db.query<ElectionOption>(
    `UPDATE election_options SET ${fields.join(', ')} WHERE id = $${idx} AND election_id = $${idx + 1} RETURNING *`,
    [...params, optionId, electionId]
  );
  return result.rows[0] || null;
}

export async function deleteOption(electionId: string, optionId: string): Promise<boolean> {
  const result = await pool.query(
    'DELETE FROM election_options WHERE id = $1 AND election_id = $2',
    [optionId, electionId]
  );
  return (result.rowCount ?? 0) > 0;
}

// ── Voters ──

export async function populateVotersFromPadron(
  electionId: string,
  filters?: { sede?: string; career?: string }
): Promise<number> {
  const conditions: string[] = ['is_active = true'];
  const params: unknown[] = [electionId];
  let idx = 2;

  if (filters?.sede) {
    conditions.push(`sede ILIKE $${idx++}`);
    params.push(filters.sede);
  }
  if (filters?.career) {
    conditions.push(`career ILIKE $${idx++}`);
    params.push(filters.career);
  }

  const where = conditions.join(' AND ');

  const result = await pool.query(
    `INSERT INTO election_voters (election_id, student_id)
     SELECT $1, id FROM students WHERE ${where}
     ON CONFLICT (election_id, student_id) DO NOTHING`,
    params
  );
  return result.rowCount ?? 0;
}

export async function populateVotersFromTag(
  electionId: string,
  tagId: string
): Promise<number> {
  const result = await pool.query(
    `INSERT INTO election_voters (election_id, student_id)
     SELECT $1, s.id
     FROM tag_members tm
     INNER JOIN students s ON s.id = tm.student_id
     WHERE tm.tag_id = $2
       AND s.is_active = true
     ON CONFLICT (election_id, student_id) DO NOTHING`,
    [electionId, tagId]
  );
  return result.rowCount ?? 0;
}

export async function populateVotersManual(
  electionId: string,
  studentIds: string[]
): Promise<number> {
  if (studentIds.length === 0) return 0;

  const values = studentIds.map((_, i) => `($1, $${i + 2})`).join(', ');
  const result = await pool.query(
    `INSERT INTO election_voters (election_id, student_id)
     VALUES ${values}
     ON CONFLICT (election_id, student_id) DO NOTHING`,
    [electionId, ...studentIds]
  );
  return result.rowCount ?? 0;
}

export async function getVoterCount(electionId: string): Promise<{ total: number; voted: number }> {
  const result = await pool.query<{ total: string; voted: string }>(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE token_used = true) AS voted
     FROM election_voters
     WHERE election_id = $1`,
    [electionId]
  );
  return {
    total: parseInt(result.rows[0].total, 10),
    voted: parseInt(result.rows[0].voted, 10),
  };
}

export async function clearVoters(electionId: string): Promise<void> {
  await pool.query(
    'DELETE FROM election_voters WHERE election_id = $1',
    [electionId]
  );
}

// ── Results ──

export async function getElectionResults(electionId: string): Promise<ElectionResults | null> {
  const election = await findElectionById(electionId);
  if (!election) return null;

  const optionsResult = await pool.query<{
    id: string;
    label: string;
    option_type: string;
    vote_count: string;
  }>(`
    SELECT eo.id, eo.label, eo.option_type,
      COUNT(v.id)::text AS vote_count
    FROM election_options eo
    LEFT JOIN votes v ON v.option_id = eo.id AND v.election_id = eo.election_id
    WHERE eo.election_id = $1
    GROUP BY eo.id, eo.label, eo.option_type, eo.display_order
    ORDER BY eo.display_order ASC
  `, [electionId]);

  const voterStats = await getVoterCount(electionId);
  const totalVotes = optionsResult.rows.reduce((acc, r) => acc + parseInt(r.vote_count, 10), 0);

  let voters: Array<{ full_name: string; carnet: string }> | undefined;
  if (!election.is_anonymous) {
    const votersResult = await pool.query<{ full_name: string; carnet: string }>(`
      SELECT s.full_name, s.carnet
      FROM election_voters ev
      INNER JOIN students s ON s.id = ev.student_id
      WHERE ev.election_id = $1 AND ev.token_used = true
      ORDER BY s.full_name ASC
    `, [electionId]);
    voters = votersResult.rows;
  }

  return {
    election,
    options: optionsResult.rows.map(r => ({
      id: r.id,
      label: r.label,
      option_type: r.option_type,
      vote_count: parseInt(r.vote_count, 10),
      percentage: totalVotes > 0 ? (parseInt(r.vote_count, 10) / totalVotes) * 100 : 0,
    })),
    total_votes: totalVotes,
    total_eligible: voterStats.total,
    participation_rate: voterStats.total > 0 ? (voterStats.voted / voterStats.total) * 100 : 0,
    voters,
  };
}


// ── Monitoreo ──
export async function getVotesByHour(electionId: string): Promise<VotesByHour[]> {
  const result = await pool.query<{ hour: Date; count: number }>(
    `SELECT 
        date_trunc('hour', created_at) as hour,
        COUNT(*)::int as count
     FROM votes
     WHERE election_id = $1
     GROUP BY hour
     ORDER BY hour ASC`,
    [electionId]
  );

  return result.rows.map(r => ({
    hour: r.hour.toISOString(), // importante para el FE
    count: r.count
  }));
}
