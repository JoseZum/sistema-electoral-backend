import { Request, Response, NextFunction } from 'express';
import * as service from '../services/postulacionService';
import { ApplicationFileContent } from '../models/postulacionModel';

function getRequestIp(req: Request): string | undefined {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip;
}

function getAuditActor(req: Request) {
  return {
    id: req.user?.studentId,
    carnet: req.user?.carnet,
    ip: getRequestIp(req),
  };
}

/**
 * Devuelve el adjunto para que el admin lo abra en la misma pestana o en
 * una nueva, tal como pidio el cliente.
 *
 * `nosniff` evita que el navegador reinterprete el contenido como HTML y
 * ejecute scripts de un archivo subido por un tercero.
 */
export function sendFileInline(res: Response, file: ApplicationFileContent): void {
  res.setHeader('Content-Type', file.mime_type);
  res.setHeader('Content-Length', String(file.size_bytes));
  res.setHeader('Content-Disposition', `inline; filename="${file.file_name}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; object-src 'self'");
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(file.content);
}

// ============================================
// FORMULARIOS
// ============================================

export async function getForms(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await service.listForms());
  } catch (error) {
    next(error);
  }
}

export async function getFormById(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await service.getForm(req.params.id as string));
  } catch (error) {
    next(error);
  }
}

export async function createForm(req: Request, res: Response, next: NextFunction) {
  try {
    const form = await service.createForm(req.body, getAuditActor(req));
    res.status(201).json(form);
  } catch (error) {
    next(error);
  }
}

export async function updateForm(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await service.updateForm(req.params.id as string, req.body, getAuditActor(req)));
  } catch (error) {
    next(error);
  }
}

export async function deleteForm(req: Request, res: Response, next: NextFunction) {
  try {
    await service.deleteForm(req.params.id as string, getAuditActor(req));
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}

// ============================================
// RESPUESTAS
// ============================================

export async function getApplications(req: Request, res: Response, next: NextFunction) {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    res.json(await service.listApplications(req.params.id as string, status));
  } catch (error) {
    next(error);
  }
}

export async function getApplicationById(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await service.getApplication(req.params.id as string));
  } catch (error) {
    next(error);
  }
}

export async function reviewApplication(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await service.reviewApplication(req.params.id as string, req.body, getAuditActor(req)));
  } catch (error) {
    next(error);
  }
}

// ============================================
// ADJUNTOS
// ============================================

export async function getFile(req: Request, res: Response, next: NextFunction) {
  try {
    sendFileInline(res, await service.getFileForAdmin(req.params.fileId as string));
  } catch (error) {
    next(error);
  }
}
