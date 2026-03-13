import { Router } from 'express';
import { pool } from '../../config/database';
import { Request, Response, NextFunction } from 'express';

const router = Router();

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 30, 100);
    const offset = (page - 1) * limit;

    const resourceType = req.query.resource_type as string | undefined;
    const action = req.query.action as string | undefined;
    const search = req.query.search as string | undefined;

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (resourceType) {
      conditions.push(`resource_type = $${paramIdx++}`);
      params.push(resourceType);
    }

    if (action) {
      conditions.push(`action ILIKE $${paramIdx++}`);
      params.push(`%${action}%`);
    }

    if (search) {
      conditions.push(`(
        actor_carnet ILIKE $${paramIdx} OR
        resource_id::TEXT ILIKE $${paramIdx} OR
        details::TEXT ILIKE $${paramIdx}
      )`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(
      `SELECT count(*) FROM audit_logs ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const dataResult = await pool.query(
      `SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset]
    );

    res.json({
      logs: dataResult.rows,
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
