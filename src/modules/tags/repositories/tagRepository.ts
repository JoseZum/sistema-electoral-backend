import { Pool, PoolClient } from 'pg';
import { pool } from '../../../config/database';
import { TagDetail, TagMember, TagSummary } from '../models/tagModel';

type Queryable = Pool | PoolClient;

export async function findAllTags(db: Queryable = pool): Promise<TagSummary[]> {
  const result = await db.query<TagSummary>(`
    SELECT
      t.id, t.name, t.description, t.color, t.created_by, t.created_at, t.updated_at,
      COUNT(tm.student_id)::int AS member_count
    FROM tags t
    LEFT JOIN tag_members tm ON tm.tag_id = t.id
    GROUP BY t.id
    ORDER BY t.name ASC
  `);
  return result.rows;
}

export async function findTagById(id: string, db: Queryable = pool): Promise<TagSummary | null> {
  const result = await db.query<TagSummary>(`
    SELECT
      t.id, t.name, t.description, t.color, t.created_by, t.created_at, t.updated_at,
      COUNT(tm.student_id)::int AS member_count
    FROM tags t
    LEFT JOIN tag_members tm ON tm.tag_id = t.id
    WHERE t.id = $1
    GROUP BY t.id
  `, [id]);
  return result.rows[0] || null;
}

export async function findTagByName(name: string, db: Queryable = pool): Promise<TagSummary | null> {
  const result = await db.query<TagSummary>(`
    SELECT
      t.id, t.name, t.description, t.color, t.created_by, t.created_at, t.updated_at,
      COUNT(tm.student_id)::int AS member_count
    FROM tags t
    LEFT JOIN tag_members tm ON tm.tag_id = t.id
    WHERE LOWER(t.name) = LOWER($1)
    GROUP BY t.id
  `, [name]);
  return result.rows[0] || null;
}

export async function findTagMembers(tagId: string, db: Queryable = pool): Promise<TagMember[]> {
  const result = await db.query<TagMember>(`
    SELECT
      tm.tag_id,
      tm.student_id AS id,
      s.carnet,
      s.full_name,
      s.sede,
      s.career,
      s.degree_level,
      s.is_active
    FROM tag_members tm
    INNER JOIN students s ON s.id = tm.student_id
    WHERE tm.tag_id = $1
      AND s.is_active = true
    ORDER BY s.full_name ASC
  `, [tagId]);
  return result.rows;
}

export async function findTagMemberIds(tagId: string, db: Queryable = pool): Promise<string[]> {
  const result = await db.query<{ student_id: string }>(
    `SELECT student_id::text AS student_id
     FROM tag_members
     WHERE tag_id = $1`,
    [tagId]
  );

  return result.rows.map((row) => row.student_id);
}

export async function findActiveStudentIdsByIds(studentIds: string[], db: Queryable = pool): Promise<string[]> {
  if (studentIds.length === 0) {
    return [];
  }

  const result = await db.query<{ id: string }>(
    'SELECT id FROM students WHERE id = ANY($1::uuid[]) AND is_active = true',
    [studentIds]
  );
  return result.rows.map((row) => row.id);
}

export async function insertTag(
  data: { name: string; description?: string | null; color: string },
  createdBy?: string | null,
  db: Queryable = pool
): Promise<TagSummary> {
  const result = await db.query<TagSummary>(`
    INSERT INTO tags (name, description, color, created_by)
    VALUES ($1, $2, $3, $4)
    RETURNING id, name, description, color, created_by, created_at, updated_at, 0::int AS member_count
  `, [data.name, data.description || null, data.color, createdBy || null]);
  return result.rows[0];
}

export async function updateTagRecord(
  id: string,
  data: { name?: string; description?: string | null; color?: string },
  db: Queryable = pool
): Promise<TagSummary | null> {
  const fields: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (data.name !== undefined) {
    fields.push(`name = $${idx++}`);
    params.push(data.name);
  }
  if (data.description !== undefined) {
    fields.push(`description = $${idx++}`);
    params.push(data.description);
  }
  if (data.color !== undefined) {
    fields.push(`color = $${idx++}`);
    params.push(data.color);
  }

  if (fields.length === 0) {
    return findTagById(id, db);
  }

  const result = await db.query<TagSummary>(`
    UPDATE tags
    SET ${fields.join(', ')}
    WHERE id = $${idx}
    RETURNING id, name, description, color, created_by, created_at, updated_at, 0::int AS member_count
  `, [...params, id]);
  return result.rows[0] || null;
}

export async function replaceTagMembers(
  tagId: string,
  studentIds: string[],
  db: Queryable = pool
): Promise<void> {
  await db.query('DELETE FROM tag_members WHERE tag_id = $1', [tagId]);

  if (studentIds.length === 0) {
    return;
  }

  const tagIds = studentIds.map(() => tagId);
  await db.query(
    `INSERT INTO tag_members (tag_id, student_id)
     SELECT * FROM unnest($1::uuid[], $2::uuid[])`,
    [tagIds, studentIds]
  );
}

export async function addTagMembers(
  tagId: string,
  studentIds: string[],
  db: Queryable = pool
): Promise<void> {
  if (studentIds.length === 0) {
    return;
  }

  const tagIds = studentIds.map(() => tagId);
  await db.query(
    `INSERT INTO tag_members (tag_id, student_id)
     SELECT * FROM unnest($1::uuid[], $2::uuid[])
     ON CONFLICT (tag_id, student_id) DO NOTHING`,
    [tagIds, studentIds]
  );
}

export async function deleteTagMembers(
  tagId: string,
  studentIds: string[],
  db: Queryable = pool
): Promise<void> {
  if (studentIds.length === 0) {
    return;
  }

  await db.query(
    'DELETE FROM tag_members WHERE tag_id = $1 AND student_id = ANY($2::uuid[])',
    [tagId, studentIds]
  );
}

export async function deleteTag(id: string, db: Queryable = pool): Promise<boolean> {
  const result = await db.query('DELETE FROM tags WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function getTagDetail(id: string, db: Queryable = pool): Promise<TagDetail | null> {
  const tag = await findTagById(id, db);
  if (!tag) return null;
  const members = await findTagMembers(id, db);
  return { ...tag, members };
}
