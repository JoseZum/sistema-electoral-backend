import { Request, Response, NextFunction } from 'express';
import * as userService from '../services/userService';

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

// ── Estudiantes ──

export async function getStudents(req: Request, res: Response, next: NextFunction) {
  try {
    const filters = {
      sede: req.query.sede as string | undefined,
      career: req.query.career as string | undefined,
      is_active: req.query.is_active !== undefined ? req.query.is_active === 'true' : true,
      search: req.query.search as string | undefined,
      page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    };
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

export async function importPadron(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Se requiere un archivo XLSX' });
      return;
    }
    const result = await userService.importPadron(req.file.buffer, {
      id: req.user?.studentId,
      carnet: req.user?.carnet,
      ip: getRequestIp(req),
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

// ── Admins ──

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
