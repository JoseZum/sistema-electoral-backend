import { Request, Response, NextFunction } from 'express';
import * as service from '../services/misPostulacionesService';
import { sendFileInline } from './postulacionController';
import { badRequest } from '../../../errors/httpErrors';

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
 * `requireStudent` ya garantizo que estos dos valores existen; el chequeo
 * es solo para satisfacer al compilador.
 */
function getSession(req: Request): { studentId: string; email: string } {
  const studentId = req.user?.studentId;
  const email = req.user?.email;

  if (!studentId || !email) {
    throw badRequest('SESSION_INCOMPLETE', 'No se pudo resolver su identidad dentro del padrón');
  }
  return { studentId, email };
}

export async function getMyForms(req: Request, res: Response, next: NextFunction) {
  try {
    const { studentId } = getSession(req);
    res.json(await service.listMyForms(studentId));
  } catch (error) {
    next(error);
  }
}

export async function getMyApplication(req: Request, res: Response, next: NextFunction) {
  try {
    const { studentId, email } = getSession(req);
    res.json(await service.getMyApplication(req.params.formId as string, studentId, email));
  } catch (error) {
    next(error);
  }
}

export async function saveMyApplication(req: Request, res: Response, next: NextFunction) {
  try {
    const { studentId, email } = getSession(req);
    res.json(
      await service.saveMyApplication(
        req.params.formId as string,
        studentId,
        email,
        req.body ?? {},
        getAuditActor(req)
      )
    );
  } catch (error) {
    next(error);
  }
}

export async function submitMyApplication(req: Request, res: Response, next: NextFunction) {
  try {
    const { studentId, email } = getSession(req);
    res.json(
      await service.submitMyApplication(req.params.formId as string, studentId, email, getAuditActor(req))
    );
  } catch (error) {
    next(error);
  }
}

export async function uploadMyFile(req: Request, res: Response, next: NextFunction) {
  try {
    const { studentId, email } = getSession(req);

    if (!req.file) {
      throw badRequest('APPLICATION_FILE_REQUIRED', 'No se recibió ningún archivo');
    }

    const file = await service.uploadMyFile(
      req.params.formId as string,
      studentId,
      email,
      req.params.fieldKey as string,
      req.file,
      getAuditActor(req)
    );
    res.status(201).json(file);
  } catch (error) {
    next(error);
  }
}

export async function deleteMyFile(req: Request, res: Response, next: NextFunction) {
  try {
    const { studentId, email } = getSession(req);
    await service.deleteMyFile(
      req.params.formId as string,
      studentId,
      email,
      req.params.fileId as string,
      getAuditActor(req)
    );
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}

export async function getMyFile(req: Request, res: Response, next: NextFunction) {
  try {
    const { studentId } = getSession(req);
    sendFileInline(res, await service.getMyFile(studentId, req.params.fileId as string));
  } catch (error) {
    next(error);
  }
}
