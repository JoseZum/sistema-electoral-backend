import { Router } from 'express';
import { pool } from '../../config/database';
import { Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireAdmin } from '../../middleware/requireAdmin';

/*
*
* Este pequeño módulo proporciona endpoints para acceder a los registros de auditoría del sistema.
*
* El módulo solo es un archivo index.ts debido a que la lógica de auditoría está implementada
* principalmente en la base de datos mediante TRIGGERS y funciones PL/pgSQL.
*
* Endpoints:
*   GET    /audit/         → consulta paginada con filtros
*   GET    /audit/stats    → conteo agregado por resource_type
*   GET    /audit/export   → descarga CSV o JSON con filtros (rango de fechas + tipos)
*   DELETE /audit/         → purga registros que coinciden con los filtros (admin)
*
*/

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
  'scrutiny.finalize': 'Escrutinio finalizado',
  'scrutiny_key.insert': 'Llave de escrutinio asignada',
  'scrutiny_key.update': 'Llave de escrutinio entregada',
  'auth.login': 'Inicio de sesion',
  'auth.logout': 'Cierre de sesion',
  'audit.purge': 'Auditoria purgada',
};

const resourceLabels: Record<string, string> = {
  student: 'estudiante',
  admin: 'administrador',
  election: 'eleccion',
  tag: 'tag',
  tag_member: 'tag',
  scrutiny_key: 'llave de escrutinio',
  auth: 'autenticacion',
  padron: 'padron',
  audit: 'auditoria',
};

// Estos resource_types NUNCA deben aparecer en auditoria por privacidad.
// Hay registros viejos en la BD que filtramos al leer.
const PRIVATE_RESOURCE_TYPES: string[] = ['vote', 'election_voter'];

// Tope defensivo para exportaciones — evita que un rango sin filtrar tumbe el servidor.
const EXPORT_HARD_LIMIT = 500_000;

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

function firstNonEmptyString(...values: Array<unknown>): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }

  return null;
}

function getTagNameFromDetails(details: Record<string, unknown> | null): string | null {
  const newRow = asObjectRecord(details?.new);
  const oldRow = asObjectRecord(details?.old);
  const changes = asObjectRecord(details?.changes);
  const previous = asObjectRecord(details?.previous);

  return firstNonEmptyString(
    newRow?.name,
    oldRow?.name,
    changes?.name,
    previous?.name,
    details?.tag_name,
    details?.target_name,
  );
}

function formatPersonReference(name: string | null, carnet: string | null): string | null {
  if (name && carnet) {
    return `${name} · ${carnet}`;
  }

  return name || carnet;
}

function getDetailString(details: Record<string, unknown> | null, key: string): string | null {
  if (!details) return null;
  const direct = details[key];
  if (typeof direct === 'string' && direct.trim().length > 0) return direct;

  const nested = ['new', 'old', 'changes', 'previous'];
  for (const slot of nested) {
    const obj = asObjectRecord(details[slot]);
    if (obj && typeof obj[key] === 'string' && (obj[key] as string).trim().length > 0) {
      return obj[key] as string;
    }
  }
  return null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      default:
        return char;
    }
  });
}

function sanitizeAuditValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return escapeHtml(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditValue(item));
  }

  if (value instanceof Date || !value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
      key,
      sanitizeAuditValue(nestedValue),
    ]),
  );
}

function sanitizeAuditRecord(row: Record<string, unknown>): Record<string, unknown> {
  return sanitizeAuditValue(row) as Record<string, unknown>;
}

function buildActivityMessage(row: Record<string, unknown>): string {
  const actionLabel = formatActionLabel((row.action as string | null) ?? null);
  const resourceLabel = formatResourceLabel((row.resource_type as string | null) ?? null);
  const resourceId = (row.resource_id as string | null) ?? null;
  const details = asObjectRecord(row.details);
  const targetName = firstNonEmptyString(row.target_name);
  const targetCarnet = firstNonEmptyString(row.target_carnet);
  const tagName = firstNonEmptyString(row.tag_name) ?? getTagNameFromDetails(details);
  const electionTitle =
    firstNonEmptyString(row.election_title) ?? getDetailString(details, 'election_title');
  const holderName = getDetailString(details, 'holder_name') ?? firstNonEmptyString(row.holder_name);
  const ballotsCountRaw = details?.ballots_count;
  const ballotsCount =
    typeof ballotsCountRaw === 'number'
      ? ballotsCountRaw
      : typeof ballotsCountRaw === 'string'
      ? Number(ballotsCountRaw)
      : null;

  if (row.resource_type === 'tag') {
    const resolvedTagName = tagName ?? targetName;
    if (resolvedTagName) {
      return `${actionLabel} "${resolvedTagName}"`;
    }
  }

  if (row.resource_type === 'tag_member') {
    const resolvedTagName = tagName;
    const personLabel = formatPersonReference(targetName, targetCarnet);

    if (resolvedTagName && personLabel) {
      return `${actionLabel} en tag "${resolvedTagName}": ${personLabel}`;
    }

    if (resolvedTagName) {
      return `${actionLabel} en tag "${resolvedTagName}"`;
    }
  }

  if (row.resource_type === 'election' && electionTitle) {
    if (row.action === 'scrutiny.finalize') {
      const submitted = details?.submitted_keys;
      if (typeof submitted === 'number' || typeof submitted === 'string') {
        return `Escrutinio finalizado de "${electionTitle}" (${submitted} llaves entregadas)`;
      }
      return `Escrutinio finalizado de "${electionTitle}"`;
    }
    if (Number.isFinite(ballotsCount) && ballotsCount !== null) {
      return `Votación cerrada de "${electionTitle}" — ${ballotsCount} boletas emitidas`;
    }
    return `${actionLabel} "${electionTitle}"`;
  }

  if (row.resource_type === 'scrutiny_key') {
    const titlePart = electionTitle ? `de "${electionTitle}"` : '';
    const holderPart = holderName ? `· ${holderName}` : '';
    const composed = [actionLabel, titlePart, holderPart].filter(Boolean).join(' ');
    if (composed.trim().length > 0) {
      return composed;
    }
  }

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
  const tagName = firstNonEmptyString(row.tag_name) ?? getTagNameFromDetails(details);
  const enrichedDetails = details ? { ...details } : {};

  if (resourceType === 'admin' || resourceType === 'student') {
    if (targetName && enrichedDetails.target_name === undefined) {
      enrichedDetails.target_name = targetName;
    }

    if (targetCarnet && enrichedDetails.target_carnet === undefined) {
      enrichedDetails.target_carnet = targetCarnet;
    }
  }

  if ((resourceType === 'tag' || resourceType === 'tag_member') && tagName && enrichedDetails.tag_name === undefined) {
    enrichedDetails.tag_name = tagName;
  }

  if (resourceType === 'tag' && targetName && enrichedDetails.target_name === undefined) {
    enrichedDetails.target_name = targetName;
  }

  if (resourceType === 'tag_member') {
    if (targetName && enrichedDetails.target_name === undefined) {
      enrichedDetails.target_name = targetName;
    }

    if (targetCarnet && enrichedDetails.target_carnet === undefined) {
      enrichedDetails.target_carnet = targetCarnet;
    }
  }

  if (resourceType === 'election' || resourceType === 'scrutiny_key') {
    const electionTitle =
      (row.election_title as string | null | undefined) ??
      (enrichedDetails.election_title as string | undefined) ??
      null;
    if (electionTitle && enrichedDetails.election_title === undefined) {
      enrichedDetails.election_title = electionTitle;
    }
  }

  if (resourceType === 'scrutiny_key') {
    const holderName = (row.holder_name as string | null | undefined) ?? null;
    const holderCarnet = (row.holder_carnet as string | null | undefined) ?? null;
    if (holderName && enrichedDetails.holder_name === undefined) {
      enrichedDetails.holder_name = holderName;
    }
    if (holderCarnet && enrichedDetails.holder_carnet === undefined) {
      enrichedDetails.holder_carnet = holderCarnet;
    }
  }

  return sanitizeAuditRecord({
    ...row,
    details: Object.keys(enrichedDetails).length > 0 ? enrichedDetails : row.details ?? null,
    actionLabel: formatActionLabel(action),
    resourceLabel: formatResourceLabel(resourceType),
    activityMessage: buildActivityMessage(row),
  });
}

// ─── Construcción común de filtros ─────────────────────────────────────────
// Centraliza el WHERE para que list, export y delete compartan la misma lógica.

interface AuditFilters {
  resourceType?: string;
  resourceTypes?: string[];
  action?: string;
  search?: string;
  from?: string; // ISO date or datetime
  to?: string;   // ISO date or datetime (inclusive end-of-day si solo viene fecha)
}

function parseFilters(req: Request): AuditFilters {
  const resourceTypesParam = req.query.resource_types as string | undefined;
  const resourceTypes = resourceTypesParam
    ? resourceTypesParam
        .split(',')
        .map((s) => s.trim())
        .filter((t) => t && !PRIVATE_RESOURCE_TYPES.includes(t))
    : undefined;

  return {
    resourceType: req.query.resource_type as string | undefined,
    resourceTypes: resourceTypes && resourceTypes.length > 0 ? resourceTypes : undefined,
    action: req.query.action as string | undefined,
    search: req.query.search as string | undefined,
    from: req.query.from as string | undefined,
    to: req.query.to as string | undefined,
  };
}

function normalizeBoundary(value: string | undefined, endOfDay: boolean): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Si es solo YYYY-MM-DD añadimos hora para incluir todo el día.
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return endOfDay ? `${trimmed}T23:59:59.999Z` : `${trimmed}T00:00:00.000Z`;
  }
  return trimmed;
}

const SHARED_FROM_CLAUSE = `
  FROM audit_logs al
  LEFT JOIN students actor_by_id ON actor_by_id.id = al.actor_id
  LEFT JOIN students actor_by_carnet
    ON actor_by_id.id IS NULL
   AND actor_by_carnet.carnet = al.actor_carnet
  LEFT JOIN tags target_tag
    ON al.resource_type = 'tag'
   AND target_tag.id::TEXT = al.resource_id
  LEFT JOIN tags target_tag_member
    ON al.resource_type = 'tag_member'
   AND target_tag_member.id::TEXT = split_part(al.resource_id, ':', 1)
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
  LEFT JOIN students target_tag_member_student
    ON al.resource_type = 'tag_member'
   AND target_tag_member_student.id::TEXT = split_part(al.resource_id, ':', 2)
  LEFT JOIN students target_student_resource
    ON al.resource_type = 'student'
   AND target_student_resource.id::TEXT = al.resource_id
  LEFT JOIN elections target_election
    ON al.resource_type = 'election'
   AND target_election.id::TEXT = al.resource_id
  LEFT JOIN scrutiny_keys target_scrutiny_key
    ON al.resource_type = 'scrutiny_key'
   AND target_scrutiny_key.id::TEXT = al.resource_id
  LEFT JOIN elections scrutiny_key_election
    ON al.resource_type = 'scrutiny_key'
   AND scrutiny_key_election.id = target_scrutiny_key.election_id
  LEFT JOIN students scrutiny_key_holder
    ON al.resource_type = 'scrutiny_key'
   AND scrutiny_key_holder.id = target_scrutiny_key.member_id
`;

const SELECT_FIELDS = `
  al.*,
  COALESCE(actor_by_id.full_name, actor_by_carnet.full_name) AS actor_name,
  COALESCE(
    al.details ->> 'target_name',
    target_student.full_name,
    target_student_resource.full_name,
    al.details -> 'old' ->> 'full_name',
    target_tag_member_student.full_name,
    target_tag.name
  ) AS target_name,
  COALESCE(
    al.details ->> 'target_carnet',
    target_student.carnet,
    target_student_resource.carnet,
    al.details -> 'old' ->> 'carnet',
    target_tag_member_student.carnet
  ) AS target_carnet,
  COALESCE(
    al.details ->> 'tag_name',
    target_tag.name,
    target_tag_member.name
  ) AS tag_name,
  COALESCE(
    al.details ->> 'election_title',
    target_election.title,
    scrutiny_key_election.title
  ) AS election_title,
  COALESCE(
    al.details ->> 'holder_name',
    scrutiny_key_holder.full_name
  ) AS holder_name,
  COALESCE(
    al.details ->> 'holder_carnet',
    scrutiny_key_holder.carnet
  ) AS holder_carnet
`;

interface BuiltWhere {
  where: string;
  params: unknown[];
  nextIdx: number;
}

function buildWhere(filters: AuditFilters, useJoinAlias: boolean): BuiltWhere {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;
  // Cuando se usa para DELETE simple no podemos referirnos a "al.*"
  const col = (name: string) => (useJoinAlias ? `al.${name}` : name);

  // Privacidad: nunca retornamos eventos individuales de voto/canjeo de token.
  if (PRIVATE_RESOURCE_TYPES.length > 0) {
    const placeholders = PRIVATE_RESOURCE_TYPES.map(() => `$${paramIdx++}`).join(', ');
    conditions.push(`${col('resource_type')} NOT IN (${placeholders})`);
    params.push(...PRIVATE_RESOURCE_TYPES);
  }

  if (filters.resourceType) {
    conditions.push(`${col('resource_type')} = $${paramIdx++}`);
    params.push(filters.resourceType);
  }

  if (filters.resourceTypes && filters.resourceTypes.length > 0) {
    const placeholders = filters.resourceTypes.map(() => `$${paramIdx++}`).join(', ');
    conditions.push(`${col('resource_type')} IN (${placeholders})`);
    params.push(...filters.resourceTypes);
  }

  if (filters.action) {
    conditions.push(`${col('action')} ILIKE $${paramIdx++}`);
    params.push(`%${filters.action}%`);
  }

  const fromIso = normalizeBoundary(filters.from, false);
  if (fromIso) {
    conditions.push(`${col('created_at')} >= $${paramIdx++}::timestamptz`);
    params.push(fromIso);
  }

  const toIso = normalizeBoundary(filters.to, true);
  if (toIso) {
    conditions.push(`${col('created_at')} <= $${paramIdx++}::timestamptz`);
    params.push(toIso);
  }

  if (filters.search && useJoinAlias) {
    conditions.push(`(
      COALESCE(actor_by_id.full_name, actor_by_carnet.full_name) ILIKE $${paramIdx} OR
      COALESCE(
        al.details ->> 'target_name',
        target_student.full_name,
        target_student_resource.full_name,
        al.details -> 'old' ->> 'full_name',
        target_tag_member_student.full_name,
        target_tag.name
      ) ILIKE $${paramIdx} OR
      COALESCE(
        al.details ->> 'target_carnet',
        target_student.carnet,
        target_student_resource.carnet,
        al.details -> 'old' ->> 'carnet',
        target_tag_member_student.carnet
      ) ILIKE $${paramIdx} OR
      COALESCE(
        al.details ->> 'tag_name',
        target_tag.name,
        target_tag_member.name
      ) ILIKE $${paramIdx} OR
      al.actor_carnet ILIKE $${paramIdx} OR
      al.resource_id::TEXT ILIKE $${paramIdx} OR
      al.details::TEXT ILIKE $${paramIdx}
    )`);
    params.push(`%${filters.search}%`);
    paramIdx++;
  }

  return {
    where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
    nextIdx: paramIdx,
  };
}

// ─── GET / : listado paginado ──────────────────────────────────────────────
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 30, 100);
    const offset = (page - 1) * limit;

    const filters = parseFilters(req);
    const { where, params, nextIdx } = buildWhere(filters, true);

    const countResult = await pool.query(
      `SELECT count(*) ${SHARED_FROM_CLAUSE} ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const dataResult = await pool.query(
      `SELECT ${SELECT_FIELDS}
       ${SHARED_FROM_CLAUSE}
       ${where}
       ORDER BY al.created_at DESC
       LIMIT $${nextIdx} OFFSET $${nextIdx + 1}`,
      [...params, limit, offset]
    );

    const logs = dataResult.rows.map((row) => withDisplayFields(row));

    res.json({ logs, total, page, limit });
  } catch (error) {
    next(error);
  }
});

// GET /active-days : dias en los que efectivamente hubo eventos 
// Pensado para alimentar selectores de rango: el front muestra solo los dias
// donde tiene sentido elegir, en vez de un calendario abierto.
router.get('/active-days', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const placeholders = PRIVATE_RESOURCE_TYPES.map((_, i) => `$${i + 1}`).join(', ');
    const where = PRIVATE_RESOURCE_TYPES.length > 0
      ? `WHERE resource_type NOT IN (${placeholders})`
      : '';
    const result = await pool.query<{ day: string; count: string }>(
      `SELECT
         to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
         count(*)::text AS count
       FROM audit_logs
       ${where}
       GROUP BY day
       ORDER BY day DESC`,
      PRIVATE_RESOURCE_TYPES,
    );
    res.json(
      result.rows.map((row) => ({
        date: row.day,
        count: parseInt(row.count, 10),
      })),
    );
  } catch (error) {
    next(error);
  }
});

router.get('/stats', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const placeholders = PRIVATE_RESOURCE_TYPES.map((_, i) => `$${i + 1}`).join(', ');
    const where = PRIVATE_RESOURCE_TYPES.length > 0
      ? `WHERE resource_type NOT IN (${placeholders})`
      : '';
    const result = await pool.query(
      `SELECT
        resource_type,
        count(*) as count,
        max(created_at) as last_activity
      FROM audit_logs
      ${where}
      GROUP BY resource_type
      ORDER BY count DESC`,
      PRIVATE_RESOURCE_TYPES,
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

// ─── GET /export : descarga CSV o JSON ─────────────────────────────────────
// Aplica los mismos filtros que el listado y emite un archivo con encabezados
// human-friendly (nombre del actor, mensaje narrativo, etc.). Tope en
// EXPORT_HARD_LIMIT para evitar accidentes con rangos abiertos.

const CSV_COLUMNS = [
  'id',
  'created_at',
  'actor_name',
  'actor_carnet',
  'action',
  'action_label',
  'resource_type',
  'resource_label',
  'resource_id',
  'target_name',
  'target_carnet',
  'tag_name',
  'election_title',
  'holder_name',
  'holder_carnet',
  'ip_address',
  'activity_message',
  'details',
] as const;

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  let str: string;
  if (typeof value === 'string') {
    str = value;
  } else if (value instanceof Date) {
    str = value.toISOString();
  } else if (typeof value === 'object') {
    str = JSON.stringify(value);
  } else {
    str = String(value);
  }
  // Excel sugiere envolver siempre que tenga , " \n \r ; o un = inicial (CSV-injection).
  const needsQuote = /[",\n\r;]/.test(str) || /^[=+\-@]/.test(str);
  const escaped = str.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}

function rowToCsv(row: Record<string, unknown>): string {
  return CSV_COLUMNS.map((col) => {
    switch (col) {
      case 'action_label':
        return csvEscape(formatActionLabel((row.action as string | null) ?? null));
      case 'resource_label':
        return csvEscape(formatResourceLabel((row.resource_type as string | null) ?? null));
      case 'activity_message':
        return csvEscape(buildActivityMessage(row));
      default:
        return csvEscape(row[col]);
    }
  }).join(',');
}

router.get(
  '/export',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const format = (req.query.format as string | undefined)?.toLowerCase() === 'json' ? 'json' : 'csv';
      const filters = parseFilters(req);
      const { where, params, nextIdx } = buildWhere(filters, true);

      const result = await pool.query(
        `SELECT ${SELECT_FIELDS}
         ${SHARED_FROM_CLAUSE}
         ${where}
         ORDER BY al.created_at DESC
         LIMIT $${nextIdx}`,
        [...params, EXPORT_HARD_LIMIT],
      );

      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `auditoria_${stamp}.${format}`;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Audit-Export-Count', String(result.rows.length));
      res.setHeader('X-Audit-Export-Limit', String(EXPORT_HARD_LIMIT));
      const enriched = result.rows.map((row) => withDisplayFields(row));

      if (format === 'json') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.json({
          exported_at: new Date().toISOString(),
          filters: {
            from: filters.from ?? null,
            to: filters.to ?? null,
            resource_types: filters.resourceTypes ?? null,
            resource_type: filters.resourceType ?? null,
            action: filters.action ?? null,
            search: filters.search ?? null,
          },
          count: enriched.length,
          truncated: enriched.length === EXPORT_HARD_LIMIT,
          logs: enriched,
        });
        return;
      }

      // CSV
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      // BOM para que Excel detecte UTF-8.
      res.write('﻿');
      res.write(CSV_COLUMNS.join(',') + '\n');
      for (const row of enriched) {
        res.write(rowToCsv(row) + '\n');
      }
      res.end();
    } catch (error) {
      next(error);
    }
  },
);

// ─── DELETE / : purga registros que coinciden con los filtros ──────────────
// Requiere permisos administrativos y al menos un filtro acotado (rango o
// tipo) para evitar borrados totales accidentales. La purga misma se registra
// como un evento `audit.purge` para dejar trazabilidad de la limpieza.

router.delete(
  '/',
  authenticate,
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    const filters: AuditFilters = {
      resourceType: req.body?.resource_type ?? req.query.resource_type,
      resourceTypes: Array.isArray(req.body?.resource_types)
        ? req.body.resource_types.filter(
            (t: unknown): t is string => typeof t === 'string' && !PRIVATE_RESOURCE_TYPES.includes(t),
          )
        : typeof req.query.resource_types === 'string'
        ? (req.query.resource_types as string)
            .split(',')
            .map((s) => s.trim())
            .filter((t) => t && !PRIVATE_RESOURCE_TYPES.includes(t))
        : undefined,
      action: req.body?.action ?? req.query.action,
      from: req.body?.from ?? req.query.from,
      to: req.body?.to ?? req.query.to,
    };

    // Salvaguarda: requerir al menos un filtro real. Borrar TODO sin filtro es
    // demasiado destructivo aún siendo admin — exigimos rango o tipo.
    const hasFilter = Boolean(
      filters.from ||
        filters.to ||
        filters.action ||
        filters.resourceType ||
        (filters.resourceTypes && filters.resourceTypes.length > 0),
    );
    if (!hasFilter) {
      res.status(400).json({
        error:
          'Debe especificar al menos un filtro (rango de fechas o tipos) para purgar la auditoría.',
      });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { where, params } = buildWhere(filters, false);
      const deleteResult = await client.query(
        `DELETE FROM audit_logs ${where}`,
        params,
      );
      const deleted = deleteResult.rowCount ?? 0;

      // Registramos la purga como evento de auditoría — trazabilidad de la limpieza.
      const actorId = req.user?.studentId ?? null;
      const actorCarnet = req.user?.carnet ?? null;
      const ip =
        (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
        req.socket.remoteAddress ||
        null;

      await client.query(
        `INSERT INTO audit_logs (actor_id, actor_carnet, action, resource_type, details, ip_address)
         VALUES ($1, $2, 'audit.purge', 'audit', $3, $4)`,
        [
          actorId,
          actorCarnet,
          {
            deleted,
            filters: {
              from: filters.from ?? null,
              to: filters.to ?? null,
              resource_types: filters.resourceTypes ?? null,
              resource_type: filters.resourceType ?? null,
              action: filters.action ?? null,
            },
          },
          ip,
        ],
      );

      await client.query('COMMIT');
      res.json({ deleted });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      next(error);
    } finally {
      client.release();
    }
  },
);

export const auditRoutes = router;
