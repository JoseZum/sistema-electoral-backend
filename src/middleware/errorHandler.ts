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

  res.status(500).json({
    error: 'Error interno del servidor',
    ...(process.env.NODE_ENV === 'development' && { details: err.message }),
  });
}
