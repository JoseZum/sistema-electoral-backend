import { Request, Response, NextFunction } from 'express';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error('Unhandled error:', err.message);

  if (err.message.includes('Only @estudiantec.cr')) {
    res.status(403).json({ error: err.message });
    return;
  }

  if (err.message.includes('not found') || err.message.includes('No email')) {
    res.status(404).json({ error: err.message });
    return;
  }

  if (err.message.includes('Invalid token') || err.message.includes('unable to decode')) {
    res.status(401).json({ error: 'Authentication failed: ' + err.message });
    return;
  }

  res.status(500).json({
    error: 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { details: err.message }),
  });
}
