/**
 * Middleware de metricas HTTP: mide latencia por peticion y alimenta el histograma
 * tee.http.server.duration con etiquetas de baja cardinalidad (metodo, ruta, status).
 *
 * Usa el patron de la ruta de Express (req.route.path) en lugar de la URL cruda para
 * evitar cardinalidad explosiva por IDs (p. ej. /api/elections/:id, no /api/elections/uuid).
 */

import { Request, Response, NextFunction } from 'express';
import { recordHttpRequest } from '../observability/metrics';

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const routePath = req.route && typeof req.route.path === 'string' ? req.route.path : '';
    const route = `${req.baseUrl || ''}${routePath}` || 'unmatched';
    const status = res.statusCode;

    recordHttpRequest(
      {
        http_method: req.method,
        route,
        status_code: status,
        status_class: `${Math.floor(status / 100)}xx`,
      },
      durationMs
    );
  });

  next();
}
