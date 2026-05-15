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
  ElectionResultOption,
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

function nestElectionOptions<T extends ElectionOption>(rows: T[]): T[] {
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

function nestResultOptions(rows: ElectionResultOption[]): ElectionResultOption[] {
  const parents = rows
    .filter((option) => !option.parent_option_id)
    .map((option) => ({ ...option, suboptions: [] as ElectionResultOption[] }));
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
      t.color AS tag_color,
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
      WHERE parent_option_id IS NULL
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
      t.color AS tag_color,
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
      t.color AS tag_color,
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
      WHERE parent_option_id IS NULL
      GROUP BY election_id
    ) eo ON eo.election_id = e.id
    WHERE e.id = $1
  `, [id]);
  return result.rows[0] || null;
}

export async function createElection(
  data: CreateElectionDto,
  createdBy?: string,
  db: Queryable = pool
): Promise<Election> {
  const status = data.status || 'DRAFT';
  const result = await db.query<Election>(
    `INSERT INTO elections (title, description, status, is_anonymous, allow_suboptions, auth_method, voter_source, voter_filter, tag_id, starts_immediately, immediate_minutes, requires_keys, min_keys, start_time, end_time, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     RETURNING *`,
    [
      data.title,
      data.description || null,
      status,
      data.is_anonymous,
      data.allow_suboptions ?? false,
      data.auth_method || 'MICROSOFT',
      data.voter_source,
      data.voter_filter ? JSON.stringify(data.voter_filter) : null,
      data.tag_id || null,
      data.starts_immediately || false,
      data.immediate_minutes ?? null,
      data.requires_keys ?? false,
      data.min_keys ?? 1,
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
  if (data.allow_suboptions !== undefined) { fields.push(`allow_suboptions = $${idx++}`); params.push(data.allow_suboptions); }
  if (data.auth_method !== undefined) { fields.push(`auth_method = $${idx++}`); params.push(data.auth_method); }
  if (data.voter_source !== undefined) { fields.push(`voter_source = $${idx++}`); params.push(data.voter_source); }
  if (data.voter_filter !== undefined) { fields.push(`voter_filter = $${idx++}`); params.push(JSON.stringify(data.voter_filter)); }
  if (data.tag_id !== undefined) { fields.push(`tag_id = $${idx++}`); params.push(data.tag_id); }
  if (data.starts_immediately !== undefined) { fields.push(`starts_immediately = $${idx++}`); params.push(data.starts_immediately); }
  if (data.immediate_minutes !== undefined) { fields.push(`immediate_minutes = $${idx++}`); params.push(data.immediate_minutes); }
  if (data.requires_keys !== undefined) { fields.push(`requires_keys = $${idx++}`); params.push(data.requires_keys); }
  if (data.min_keys !== undefined) { fields.push(`min_keys = $${idx++}`); params.push(data.min_keys); }
  if (data.status !== undefined) {
    fields.push(`status = $${idx++}`);
    params.push(data.status);
    if (data.status === 'SCRUTINIZED') {
      fields.push('scrutinized_at = COALESCE(scrutinized_at, now())');
    }
  }
  if (data.start_time !== undefined) { fields.push(`start_time = $${idx++}`); params.push(data.start_time); }
  if (data.end_time !== undefined) { fields.push(`end_time = $${idx++}`); params.push(data.end_time); }

  if (fields.length === 0) return findElectionById(id);

  const result = await db.query<Election>(
    `UPDATE elections SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    [...params, id]
  );
  return result.rows[0] || null;
}

export async function deleteElection(id: string, db: Queryable = pool): Promise<boolean> {
  const result = await db.query(
    `DELETE FROM elections WHERE id = $1`,
    [id]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function updateElectionStatus(id: string, status: Election['status'], db: Queryable = pool): Promise<Election | null> {
  const result = await db.query<Election>(
    `UPDATE elections
     SET status = $1,
         scrutinized_at = CASE
           WHEN $1 = 'SCRUTINIZED' THEN COALESCE(scrutinized_at, now())
           ELSE scrutinized_at
         END
     WHERE id = $2
     RETURNING *`,
    [status, id]
  );
  return result.rows[0] || null;
}

// Opciones de votación 

export async function findOptionsByElection(electionId: string): Promise<ElectionOption[]> {
  const result = await pool.query<ElectionOption>(
    `SELECT eo.*
     FROM election_options eo
     LEFT JOIN election_options parent ON parent.id = eo.parent_option_id
     WHERE eo.election_id = $1
     ORDER BY COALESCE(parent.display_order, eo.display_order) ASC,
       CASE WHEN eo.parent_option_id IS NULL THEN 0 ELSE 1 END ASC,
       eo.display_order ASC`,
    [electionId]
  );
  return nestElectionOptions(result.rows);
}

export async function createOption(
  electionId: string,
  data: CreateOptionDto,
  db: Queryable = pool
): Promise<ElectionOption> {
  const metadata = withOptionMetadata(data.description, data.metadata);
  const result = await db.query<ElectionOption>(
    `INSERT INTO election_options (election_id, parent_option_id, label, option_type, image_url, display_order, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      electionId,
      data.parent_option_id || null,
      data.label,
      data.option_type,
      data.image_url || null,
      data.display_order || 0,
      metadata ? JSON.stringify(metadata) : null,
    ]
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
  if (data.image_url !== undefined) { fields.push(`image_url = $${idx++}`); params.push(data.image_url); }
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

// Votantes

export async function populateVotersFromPadron(
  electionId: string,
  filters?: { sede?: string; career?: string },
  db: Queryable = pool
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

  const result = await db.query(
    `INSERT INTO election_voters (election_id, student_id)
     SELECT $1, id FROM students WHERE ${where}
     ON CONFLICT (election_id, student_id) DO NOTHING`,
    params
  );
  return result.rowCount ?? 0;
}

export async function populateVotersFromTag(
  electionId: string,
  tagId: string,
  db: Queryable = pool
): Promise<number> {
  const result = await db.query(
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
  studentIds: string[],
  db: Queryable = pool
): Promise<number> {
  if (studentIds.length === 0) return 0;

  const values = studentIds.map((_, i) => `($1, $${i + 2})`).join(', ');
  const result = await db.query(
    `INSERT INTO election_voters (election_id, student_id)
     VALUES ${values}
     ON CONFLICT (election_id, student_id) DO NOTHING`,
    [electionId, ...studentIds]
  );
  return result.rowCount ?? 0;
}

export async function getVoterCount(electionId: string, db: Queryable = pool): Promise<{ total: number; voted: number }> {
  const result = await db.query<{ total: string; voted: string }>(
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

export async function getSubmittedScrutinyKeyCount(electionId: string, db: Queryable = pool): Promise<number> {
  const result = await db.query<{ submitted_keys: number | string }>(
    `SELECT COUNT(*)::int AS submitted_keys
     FROM scrutiny_keys
     WHERE election_id = $1
       AND has_submitted = true`,
    [electionId]
  );

  return Number(result.rows[0]?.submitted_keys ?? 0);
}

export async function clearVoters(electionId: string, db: Queryable = pool): Promise<void> {
  await db.query(
    'DELETE FROM election_voters WHERE election_id = $1',
    [electionId]
  );
}

// Resultados

export async function getElectionResults(electionId: string): Promise<ElectionResults | null> {
  const election = await findElectionById(electionId);
  if (!election) return null;

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

  const voterStats = await getVoterCount(electionId);
  const flatOptions: ElectionResultOption[] = optionsResult.rows.map((row) => ({
    id: row.id,
    label: row.label,
    option_type: row.option_type,
    parent_option_id: row.parent_option_id,
    image_url: row.image_url,
    metadata: row.metadata,
    vote_count: Number(row.vote_count),
    percentage: 0,
  }));
  const totalVotes = election.allow_suboptions
    ? voterStats.voted
    : flatOptions
        .filter((option) => !option.parent_option_id)
        .reduce((acc, option) => acc + option.vote_count, 0);
  const resultOptions = election.allow_suboptions
    ? nestResultOptions(flatOptions).map((parent) => {
        const suboptions = parent.suboptions ?? [];
        const parentTotal = suboptions.reduce((acc, option) => acc + option.vote_count, 0);
        return {
          ...parent,
          vote_count: parentTotal,
          percentage: totalVotes > 0 ? (parentTotal / totalVotes) * 100 : 0,
          suboptions: suboptions.map((option) => ({
            ...option,
            percentage: parentTotal > 0 ? (option.vote_count / parentTotal) * 100 : 0,
          })),
        };
      })
    : flatOptions
        .filter((option) => !option.parent_option_id)
        .map((option) => ({
          ...option,
          percentage: totalVotes > 0 ? (option.vote_count / totalVotes) * 100 : 0,
        }));

  const votersResult = await pool.query<{
    full_name: string;
    carnet: string;
    has_voted: boolean;
    selected_option_label: string | null;
  }>(`
    SELECT
      s.full_name,
      s.carnet,
      ev.token_used AS has_voted,
      string_agg(
        CASE
          WHEN selected.id IS NULL THEN NULL
          WHEN parent.id IS NULL THEN selected.label
          ELSE parent.label || ': ' || selected.label
        END,
        ', ' ORDER BY COALESCE(parent.display_order, selected.display_order), selected.display_order
      ) AS selected_option_label
    FROM election_voters ev
    INNER JOIN students s ON s.id = ev.student_id
    LEFT JOIN votes v
      ON v.election_id = ev.election_id
     AND v.student_id = ev.student_id
    LEFT JOIN election_options selected ON selected.id = v.option_id
    LEFT JOIN election_options parent ON parent.id = v.parent_option_id
    WHERE ev.election_id = $1
    GROUP BY s.full_name, s.carnet, ev.token_used
    ORDER BY s.full_name ASC
  `, [electionId]);

  return {
    election,
    options: resultOptions,
    total_votes: totalVotes,
    total_eligible: voterStats.total,
    participation_rate: voterStats.total > 0 ? (voterStats.voted / voterStats.total) * 100 : 0,
    voters: votersResult.rows.map((voter) => ({
      ...voter,
      has_voted: Boolean(voter.has_voted),
      selected_option_label: election.is_anonymous ? null : voter.selected_option_label,
    })),
  };
}

// Para monitoreo
export async function getVotesByHour(electionId: string): Promise<VotesByHour[]> {
  const result = await pool.query<{ hour: Date; count: number }>(
    `SELECT 
        date_trunc('hour', created_at) as hour,
        COUNT(DISTINCT COALESCE(student_id::text, token_hash))::int as count
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
