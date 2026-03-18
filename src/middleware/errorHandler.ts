import { Request, Response, NextFunction } from 'express';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error('Error no manejado:', err.message);

  if (err.message.includes('Solo se permiten cuentas @estudiantec.cr') || err.message.includes('@estudiantec.cr')) {
    res.status(403).json({ error: err.message });
    return;
  }

  if (err.message.includes('no encontrado') || err.message.includes('No se encontró')) {
    res.status(404).json({ error: err.message });
    return;
  }

  if (err.message.includes('inválido') || err.message.includes('no se pudo decodificar')) {
    res.status(401).json({ error: 'Autenticación fallida: ' + err.message });
    return;
  }

  if (
    err.message.includes('Solo se puede') ||
    err.message.includes('Solo se pueden') ||
    err.message.includes('No se puede cambiar') ||
    err.message.includes('Se necesitan al menos') ||
    err.message.includes('Se necesita al menos') ||
    err.message.includes('no son v') ||
    err.message.includes('La fecha de cierre')
  ) {
    res.status(400).json({ error: err.message });
    return;
  }

  res.status(500).json({
    error: 'Error interno del servidor',
    ...(process.env.NODE_ENV === 'development' && { details: err.message }),
  });
}
