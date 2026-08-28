import { Request, Response, NextFunction } from 'express';
import { findStudentByCarnet, findStudentByEmail } from '../modules/users/repositories/studentRepository';

/**
 * Resuelve el id de padron del usuario autenticado.
 *
 * No se confia ciegamente en el claim `studentId` del JWT: si no viene, se
 * busca al estudiante por correo y, en ultimo caso, por carne.
 */
export async function resolveCurrentStudentId(req: Request): Promise<string | null> {
  if (req.user?.studentId) {
    return req.user.studentId;
  }

  const email = req.user?.email?.toLowerCase();
  let student = email ? await findStudentByEmail(email) : null;

  if (!student && req.user?.carnet) {
    student = await findStudentByCarnet(req.user.carnet);
  }

  return student?.id ?? null;
}

/**
 * Exige que el usuario autenticado exista en el padron y deja su id en
 * `req.user.studentId`.
 *
 * Es el equivalente de `requireAdmin` para las rutas de votante: no pide
 * permisos administrativos, solo identidad verificable dentro del padron.
 */
export async function requireStudent(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
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

    req.user.studentId = studentId;
    next();
  } catch (error) {
    next(error);
  }
}
