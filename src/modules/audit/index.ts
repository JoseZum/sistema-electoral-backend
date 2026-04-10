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

  return {
    ...row,
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
    `;

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

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
         COALESCE(actor_by_id.full_name, actor_by_carnet.full_name) AS actor_name
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
      GROUP BY resource_type
      ORDER BY count DESC
    `);
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

export const auditRoutes = router;
