import { AppError } from '../../../errors/appError';
import { verifyMicrosoftIdToken } from './microsoftTokenService';
import { findStudentByEmail } from '../../users/repositories/studentRepository';
import { findAdminByStudentId } from '../../users/repositories/adminRepository';
import { createSessionJWT } from './jwtUtils';
import { AuthResponse, SessionJWTPayload } from '../models/authModel';

const ALLOWED_DOMAIN = '@estudiantec.cr';

export async function authenticateWithMicrosoft(idToken: string): Promise<AuthResponse> {
  const claims = await verifyMicrosoftIdToken(idToken);

  const email = claims.email || claims.preferred_username;
  if (!email) {
    throw new AppError({
      status: 401,
      code: 'AUTH_EMAIL_MISSING',
      message: 'Autenticacion fallida: no se encontro correo en la cuenta de Microsoft.',
    });
  }

  if (!email.toLowerCase().endsWith(ALLOWED_DOMAIN)) {
    throw new AppError({
      status: 403,
      code: 'AUTH_DOMAIN_NOT_ALLOWED',
      message: 'Solo se permiten cuentas @estudiantec.cr',
    });
  }

  const student = await findStudentByEmail(email.toLowerCase());
  if (!student) {
    throw new AppError({
      status: 404,
      code: 'AUTH_STUDENT_NOT_FOUND',
      message: 'Estudiante no encontrado en el padron electoral. Contacte al TEE.',
    });
  }

  let role: SessionJWTPayload['role'] = 'voter';

  const admin = await findAdminByStudentId(student.id);
  if (admin) {
    role = 'admin';
  }

  const sessionPayload: SessionJWTPayload = {
    studentId: student.id,
    carnet: student.carnet,
    email: student.email,
    fullName: student.full_name,
    role,
  };

  const token = createSessionJWT(sessionPayload);

  return {
    token,
    user: {
      studentId: student.id,
      carnet: student.carnet,
      fullName: student.full_name,
      email: student.email,
      role,
      sede: student.sede,
      career: student.career,
    },
  };
}
