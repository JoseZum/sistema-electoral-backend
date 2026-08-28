import { Request, Response, NextFunction } from 'express';
import { findAdminByStudentId } from '../modules/users/repositories/adminRepository';
import { resolveCurrentStudentId } from './resolveStudent';

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'No autenticado' });
    return;
  }

  try {
    const studentId = await resolveCurrentStudentId(req);

    if (!studentId) {
      res.status(403).json({ error: 'No se pudo resolver su identidad dentro del padron.' });
      return;
    }

    const admin = await findAdminByStudentId(studentId);

    if (!admin) {
      res.status(403).json({ error: 'Se requieren permisos administrativos para esta accion.' });
      return;
    }

    req.user.studentId = studentId;
    req.admin = admin;
    next();
  } catch (error) {
    next(error);
  }
}
