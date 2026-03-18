import { Request, Response, NextFunction } from 'express';
import { findAdminById, findAdminByStudentId } from '../modules/users/repositories/adminRepository';
import { findStudentByCarnet, findStudentByEmail } from '../modules/users/repositories/studentRepository';

async function resolveActiveAdmin(req: Request) {
  if (req.user?.teeMemberId) {
    const adminByToken = await findAdminById(req.user.teeMemberId);
    if (adminByToken?.is_active) {
      return adminByToken;
    }
  }

  const email = req.user?.email?.toLowerCase();
  let student = email ? await findStudentByEmail(email) : null;

  if (!student && req.user?.carnet) {
    student = await findStudentByCarnet(req.user.carnet);
  }

  if (!student) {
    return null;
  }

  return findAdminByStudentId(student.id);
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'No autenticado' });
    return;
  }

  try {
    const admin = await resolveActiveAdmin(req);

    if (!admin) {
      const message = req.user.teeMemberId
        ? 'Su sesi\u00f3n administrativa ya no es v\u00e1lida. Inicie sesi\u00f3n nuevamente.'
        : 'Se requieren permisos administrativos para gestionar elecciones.';
      res.status(403).json({ error: message });
      return;
    }

    req.admin = admin;
    req.user.teeMemberId = admin.id;
    next();
  } catch (error) {
    next(error);
  }
}
