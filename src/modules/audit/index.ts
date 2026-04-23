import { Router } from 'express';
import { pool } from '../../config/database';
import { Request, Response, NextFunction } from 'express';

const router = Router();

const actionLabels: Record<string, string> = {
  'student.insert': 'Estudiante agregado',
  'student.update': 'Estudiante actualizado',
  'student.delete': 'Estudiante eliminado',
  'admin.insert': 'Administrador agregado',
  'admin.update': 'Administrador actualizado',
  'admin.delete': 'Administrador eliminado',
  'election.insert': 'Eleccion creada',
  'election.update': 'Eleccion actualizada',
  'election.delete': 'Eleccion eliminada',
  'tag.insert': 'Tag creada',
  'tag.update': 'Tag actualizada',
  'tag.delete': 'Tag eliminada',
  'tag_member.insert': 'Miembro agregado a tag',
  'tag_member.delete': 'Miembro eliminado de tag',
  'election.open': 'Eleccion abierta',
  'election.close': 'Eleccion cerrada',
  'vote.insert': 'Voto emitido',
  'vote.delete': 'Voto eliminado',
  'auth.login': 'Inicio de sesion',
  'auth.logout': 'Cierre de sesion',
};

const resourceLabels: Record<string, string> = {
  student: 'estudiante',
  admin: 'administrador',
  election: 'eleccion',
  tag: 'tag',
  tag_member: 'tag',
  vote: 'voto',
  auth: 'autenticacion',
  padron: 'padron',
};

function toTitleCase(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatActionLabel(action: string | null): string {
  if (!action) return 'Actividad registrada';
  const mapped = actionLabels[action];
  if (mapped) return mapped;
  return toTitleCase(action.replace(/[._]+/g, ' ').toLowerCase());
}

function formatResourceLabel(resourceType: string | null): string {
  if (!resourceType) return 'recurso';
  return resourceLabels[resourceType] || resourceType.toLowerCase();
}

function asObjectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return { ...(value as Record<string, unknown>) };
}

function buildActivityMessage(row: Record<string, unknown>): string {
  const actionLabel = formatActionLabel((row.action as string | null) ?? null);
  const resourceLabel = formatResourceLabel((row.resource_type as string | null) ?? null);
  const resourceId = (row.resource_id as string | null) ?? null;

  if (resourceId) {
    return `${actionLabel} en ${resourceLabel} ${resourceId}`;
  }

  return `${actionLabel} en ${resourceLabel}`;
}

function withDisplayFields(row: Record<string, unknown>): Record<string, unknown> {
  const action = (row.action as string | null) ?? null;
  const resourceType = (row.resource_type as string | null) ?? null;
  const details = asObjectRecord(row.details);
  const targetName = (row.target_name as string | null | undefined) ?? null;
  const targetCarnet = (row.target_carnet as string | null | undefined) ?? null;
  const enrichedDetails = details ? { ...details } : {};

  if (resourceType === 'admin') {
    if (targetName && enrichedDetails.target_name === undefined) {
      enrichedDetails.target_name = targetName;
    }

    if (targetCarnet && enrichedDetails.target_carnet === undefined) {
      enrichedDetails.target_carnet = targetCarnet;
    }
  }

  return {
    ...row,
    details: Object.keys(enrichedDetails).length > 0 ? enrichedDetails : row.details ?? null,
    actionLabel: formatActionLabel(action),
    resourceLabel: formatResourceLabel(resourceType),
    activityMessage: buildActivityMessage(row),
  };
}

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 30, 100);
    const offset = (page - 1) * limit;

    const resourceType = req.query.resource_type as string | undefined;
    const resourceTypesParam = req.query.resource_types as string | undefined;
    const action = req.query.action as string | undefined;
    const search = req.query.search as string | undefined;

    const fromClause = `
      FROM audit_logs al
      LEFT JOIN students actor_by_id ON actor_by_id.id = al.actor_id
      LEFT JOIN students actor_by_carnet
        ON actor_by_id.id IS NULL
       AND actor_by_carnet.carnet = al.actor_carnet
      LEFT JOIN admins target_admin
        ON al.resource_type = 'admin'
       AND target_admin.id::TEXT = al.resource_id
      LEFT JOIN students target_student
        ON al.resource_type = 'admin'
       AND target_student.id::TEXT = COALESCE(
         target_admin.students_id::TEXT,
         al.details -> 'new' ->> 'students_id',
         al.details -> 'old' ->> 'students_id',
         al.details -> 'changes' ->> 'students_id',
         al.details -> 'previous' ->> 'students_id'
       )
    `;

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    conditions.push(`al.resource_type <> 'tag_member'`);

    if (resourceType) {
      conditions.push(`al.resource_type = $${paramIdx++}`);
      params.push(resourceType);
    }

    if (resourceTypesParam) {
      const types = resourceTypesParam
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (types.length > 0) {
        const placeholders = types.map(() => `$${paramIdx++}`).join(', ');
        conditions.push(`al.resource_type IN (${placeholders})`);
        params.push(...types);
      }
    }

    if (action) {
      conditions.push(`al.action ILIKE $${paramIdx++}`);
      params.push(`%${action}%`);
    }

    if (search) {
      conditions.push(`(
        COALESCE(actor_by_id.full_name, actor_by_carnet.full_name) ILIKE $${paramIdx} OR
        COALESCE(al.details ->> 'target_name', target_student.full_name) ILIKE $${paramIdx} OR
        COALESCE(al.details ->> 'target_carnet', target_student.carnet) ILIKE $${paramIdx} OR
        al.actor_carnet ILIKE $${paramIdx} OR
        al.resource_id::TEXT ILIKE $${paramIdx} OR
        al.details::TEXT ILIKE $${paramIdx}
      )`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(
      `SELECT count(*) ${fromClause} ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const dataResult = await pool.query(
      `SELECT
         al.*,
         COALESCE(actor_by_id.full_name, actor_by_carnet.full_name) AS actor_name,
         COALESCE(al.details ->> 'target_name', target_student.full_name) AS target_name,
         COALESCE(al.details ->> 'target_carnet', target_student.carnet) AS target_carnet
       ${fromClause}
       ${where}
       ORDER BY al.created_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset]
    );

    const logs = dataResult.rows.map((row) => withDisplayFields(row));

    res.json({
      logs,
      total,
      page,
      limit,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/stats', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await pool.query(`
      SELECT
        resource_type,
        count(*) as count,
        max(created_at) as last_activity
      FROM audit_logs
      WHERE resource_type <> 'tag_member'
      GROUP BY resource_type
      ORDER BY count DESC
    `);
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

export const auditRoutes = router;
