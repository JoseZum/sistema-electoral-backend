import { withAuditContext } from '../../../config/audit-context';
import { PoolClient } from 'pg';
import { pool } from '../../../config/database';
import * as tagRepo from '../repositories/tagRepository';
import { CreateTagDto, TagDetail, UpdateTagDto } from '../models/tagModel';
import { DEFAULT_TAG_COLOR, TAG_COLOR_VALUES } from '../constants/tagColors';

type AuditActor = {
  id?: string;
  carnet?: string;
  ip?: string;
};

async function withOptionalAudit<T>(
  actor: AuditActor | undefined,
  fn: (client?: PoolClient) => Promise<T>
): Promise<T> {
  if (actor?.id || actor?.carnet || actor?.ip) {
    return withAuditContext(actor, (client) => fn(client));
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function setAuditSessionValue(client: PoolClient, key: string, value: string) {
  await client.query('SELECT set_config($1, $2, true)', [key, value]);
}

function normalizeTagName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

function diffStudentIds(currentIds: string[], nextIds: string[]) {
  const currentSet = new Set(currentIds);
  const nextSet = new Set(nextIds);

  return {
    toAdd: nextIds.filter((studentId) => !currentSet.has(studentId)),
    toRemove: currentIds.filter((studentId) => !nextSet.has(studentId)),
  };
}

function normalizeStudentIds(studentIds: string[]): string[] {
  return Array.from(new Set(studentIds.map((studentId) => studentId.trim()).filter(Boolean)));
}

function normalizeTagColor(color?: string | null): string {
  const normalized = (color || DEFAULT_TAG_COLOR).trim().toUpperCase();

  if (!TAG_COLOR_VALUES.includes(normalized as typeof TAG_COLOR_VALUES[number])) {
    throw new Error('Selecciona un color valido para la tag');
  }

  return normalized;
}

async function validateStudentIds(studentIds: string[], client?: PoolClient): Promise<string[]> {
  if (studentIds.length === 0) {
    throw new Error('Se necesita al menos un estudiante para crear la tag');
  }

  const validStudentIds = client
    ? (await client.query<{ id: string }>(
        'SELECT id FROM students WHERE id = ANY($1::uuid[]) AND is_active = true',
        [studentIds]
      )).rows.map((row) => row.id)
    : await tagRepo.findActiveStudentIdsByIds(studentIds);

  if (validStudentIds.length !== studentIds.length) {
    throw new Error('Estudiante no encontrado en el padron');
  }

  return validStudentIds;
}

function buildTagCreationAuditSummary(detail: TagDetail) {
  return {
    member_count: detail.members.length,
    members_summary: detail.members
      .map((member) => `${member.full_name} - ${member.carnet}`)
      .join(', '),
    members: detail.members.map((member) => ({
      id: member.id,
      full_name: member.full_name,
      carnet: member.carnet,
      sede: member.sede,
      career: member.career,
    })),
  };
}

async function enrichTagCreationAudit(
  client: PoolClient,
  tagId: string,
  summary: Record<string, unknown>
) {
  await client.query(
    `WITH target AS (
       SELECT id
       FROM audit_logs
       WHERE action = 'tag.insert'
         AND resource_type = 'tag'
         AND resource_id = $1
       ORDER BY created_at DESC
       LIMIT 1
     )
     UPDATE audit_logs al
     SET details = jsonb_set(
       COALESCE(al.details, '{}'::jsonb),
       '{new}',
       COALESCE(al.details -> 'new', '{}'::jsonb) || $2::jsonb
     )
     FROM target
     WHERE al.id = target.id`,
    [tagId, JSON.stringify(summary)]
  );
}

export async function getTags(): Promise<Awaited<ReturnType<typeof tagRepo.findAllTags>>> {
  return tagRepo.findAllTags();
}

export async function getTag(id: string): Promise<TagDetail> {
  const tag = await tagRepo.getTagDetail(id);
  if (!tag) {
    throw new Error('Tag no encontrada');
  }
  return tag;
}

export async function getTagById(id: string): Promise<TagDetail> {
  return getTag(id);
}

export async function createTag(data: CreateTagDto, actor?: AuditActor): Promise<TagDetail> {
  const name = normalizeTagName(data.name || '');
  const color = normalizeTagColor(data.color);
  const studentIds = normalizeStudentIds(data.student_ids || []);

  if (!name) {
    throw new Error('Se necesita un nombre para la tag');
  }

  return withOptionalAudit(actor, async (client) => {
    if (!client) {
      throw new Error('No se pudo iniciar la transaccion de creacion');
    }

    const existing = await tagRepo.findTagByName(name, client);
    if (existing) {
      throw new Error('Se necesita un nombre unico para la tag');
    }

    const validStudentIds = await validateStudentIds(studentIds, client);
    const tag = await tagRepo.insertTag({ name, description: data.description || null, color }, actor?.id, client);
    await setAuditSessionValue(client, 'app.compound_tag_mode', 'true');
    await tagRepo.replaceTagMembers(tag.id, validStudentIds, client);
    const detail = await tagRepo.getTagDetail(tag.id, client);

    if (!detail) {
      throw new Error('Tag no encontrada');
    }

    await enrichTagCreationAudit(client, tag.id, buildTagCreationAuditSummary(detail));

    return detail;
  });
}

export async function updateTag(id: string, data: UpdateTagDto, actor?: AuditActor): Promise<TagDetail> {
  const nextName = data.name !== undefined ? normalizeTagName(data.name) : undefined;
  const nextColor = data.color !== undefined ? normalizeTagColor(data.color) : undefined;
  const nextStudentIds = data.student_ids !== undefined ? normalizeStudentIds(data.student_ids) : undefined;

  if (nextName !== undefined && !nextName) {
    throw new Error('Se necesita un nombre para la tag');
  }

  return withOptionalAudit(actor, async (client) => {
    if (!client) {
      throw new Error('No se pudo iniciar la transaccion de actualizacion');
    }

    const current = await tagRepo.findTagById(id, client);
    if (!current) {
      throw new Error('Tag no encontrada');
    }

    if (nextName !== undefined) {
      const existing = await tagRepo.findTagByName(nextName, client);
      if (existing && existing.id !== id) {
        throw new Error('Se necesita un nombre unico para la tag');
      }
    }

    if (nextStudentIds !== undefined) {
      await validateStudentIds(nextStudentIds, client);
    }

    await tagRepo.updateTagRecord(id, {
      name: nextName,
      description: data.description !== undefined ? data.description || null : undefined,
      color: nextColor,
    }, client);

    if (nextStudentIds !== undefined) {
      const currentMemberIds = await tagRepo.findTagMemberIds(id, client);
      const { toAdd, toRemove } = diffStudentIds(currentMemberIds, nextStudentIds);

      await tagRepo.deleteTagMembers(id, toRemove, client);
      await tagRepo.addTagMembers(id, toAdd, client);
    }

    const detail = await tagRepo.getTagDetail(id, client);
    if (!detail) {
      throw new Error('Tag no encontrada');
    }

    return detail;
  });
}

export async function deleteTag(id: string, actor?: AuditActor): Promise<{ success: true }> {
  return withOptionalAudit(actor, async (client) => {
    if (!client) {
      throw new Error('No se pudo iniciar la transaccion de eliminacion');
    }

    await setAuditSessionValue(client, 'app.compound_tag_mode', 'true');
    const deleted = await tagRepo.deleteTag(id, client);
    if (!deleted) {
      throw new Error('Tag no encontrada');
    }
    return { success: true as const };
  });
}
