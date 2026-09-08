import { Request, Response, NextFunction } from 'express';
import * as userService from '../services/userService';
import { parseInput } from '../../../validation/parseInput';
import { padronImportOptionsSchema, studentFiltersSchema } from '../schemas/userSchemas';
import { badRequest } from '../../../errors/httpErrors';

// Controladores para la gestión de usuarios (estudiantes y admins)

function getRequestIp(req: Request): string | undefined {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string') {
    return forwardedFor.split(',')[0]?.trim();
  }
  if (Array.isArray(forwardedFor) && forwardedFor.length > 0) {
    return forwardedFor[0];
  }
  return req.ip || req.socket.remoteAddress;
}

function getAuditActor(req: Request) {
  return {
    id: req.user?.studentId,
    carnet: req.user?.carnet,
    ip: getRequestIp(req),
  };
}

// Sección de Estudiantes

export async function getStudents(req: Request, res: Response, next: NextFunction) {
  try {
    const filters = parseInput(studentFiltersSchema, req.query, 'query');
    const result = await userService.getAllStudents(filters);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function getStudentCatalog(_req: Request, res: Response, next: NextFunction) {
  try {
    const catalog = await userService.getStudentCatalog();
    res.json(catalog);
  } catch (error) {
    next(error);
  }
}

export async function getStudentById(req: Request, res: Response, next: NextFunction) {
  try {
    const student = await userService.getStudentById(req.params.id as string);
    res.json(student);
  } catch (error) {
    next(error);
  }
}

export async function createStudent(req: Request, res: Response, next: NextFunction) {
  try {
    const student = await userService.createStudent(req.body, getAuditActor(req));
    res.status(201).json(student);
  } catch (error) {
    next(error);
  }
}

export async function updateStudent(req: Request, res: Response, next: NextFunction) {
  try {
    const student = await userService.updateStudent(req.params.id as string, req.body, getAuditActor(req));
    res.json(student);
  } catch (error) {
    next(error);
  }
}

export async function deleteStudent(req: Request, res: Response, next: NextFunction) {
  try {
    const student = await userService.deactivateStudent(req.params.id as string, getAuditActor(req));
    res.json(student);
  } catch (error) {
    next(error);
  }
}

/**
 * Las opciones del import viajan como un campo de texto del multipart, porque el
 * cuerpo lo ocupa el archivo. Llegan en JSON y se validan con Zod igual que
 * cualquier otro body.
 */
function parsePadronOptions(req: Request) {
  const raw = req.body?.options;
  if (raw === undefined || raw === null || raw === '') {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    throw badRequest('PADRON_OPTIONS_INVALID', 'Las opciones de importación no son un JSON válido.');
  }

  return parseInput(padronImportOptionsSchema, parsed, 'body');
}

export async function analyzePadron(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Se requiere un archivo XLSX' });
      return;
    }
    const options = parsePadronOptions(req);
    const result = await userService.analyzePadron(req.file.buffer, options, getAuditActor(req));
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function importPadron(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Se requiere un archivo XLSX' });
      return;
    }
    const options = parsePadronOptions(req);
    const result = await userService.importPadron(req.file.buffer, options, getAuditActor(req));
    res.json(result);
  } catch (error) {
    next(error);
  }
}

// Sección de Administradores

export async function getAdmins(_req: Request, res: Response, next: NextFunction) {
  try {
    const admins = await userService.getAllAdmins();
    res.json(admins);
  } catch (error) {
    next(error);
  }
}

export async function getAdminById(req: Request, res: Response, next: NextFunction) {
  try {
    const admin = await userService.getAdminById(req.params.id as string);
    res.json(admin);
  } catch (error) {
    next(error);
  }
}

export async function createAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const admin = await userService.createAdmin(req.body, getAuditActor(req));
    res.status(201).json(admin);
  } catch (error) {
    next(error);
  }
}

export async function updateAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const admin = await userService.updateAdmin(req.params.id as string, req.body, getAuditActor(req));
    res.json(admin);
  } catch (error) {
    next(error);
  }
}

export async function deleteAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const admin = await userService.deleteAdmin(req.params.id as string, getAuditActor(req));
    res.json(admin);
  } catch (error) {
    next(error);
  }
}
