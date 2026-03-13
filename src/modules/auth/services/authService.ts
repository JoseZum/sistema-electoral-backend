import { verifyMicrosoftIdToken } from './microsoftTokenService';
import { findStudentByEmail } from '../../users/repositories/studentRepository';
import { findAdminByStudentId } from '../../users/repositories/adminRepository';
import { createSessionJWT } from './jwtUtils';
import { AuthResponse, SessionJWTPayload } from '../models/authModel';

const ALLOWED_DOMAIN = '@estudiantec.cr';

export async function authenticateWithMicrosoft(idToken: string): Promise<AuthResponse> {
  // 1. Verificar token de Microsoft ID
  const claims = await verifyMicrosoftIdToken(idToken);

  const email = claims.email || claims.preferred_username;
  if (!email) {
    throw new Error('No se encontró correo electrónico en los claims del token');
  }

  // 2. Validar dominio @estudiantec.cr
  if (!email.toLowerCase().endsWith(ALLOWED_DOMAIN)) {
    throw new Error('Solo se permiten cuentas @estudiantec.cr');
  }

  // 3. Buscar estudiante en el padrón
  const student = await findStudentByEmail(email.toLowerCase());
  if (!student) {
    throw new Error('Estudiante no encontrado en el padrón electoral. Contacte al TEE.');
  }

  // 4. Verificar si es admin del TEE
  let role: SessionJWTPayload['role'] = 'voter';
  let teeMemberId: string | undefined;

  const admin = await findAdminByStudentId(student.id);
  if (admin) {
    role = admin.role as SessionJWTPayload['role'];
    teeMemberId = admin.id;
  }

  // 5. Crear JWT de sesión
  const sessionPayload: SessionJWTPayload = {
    carnet: student.carnet,
    email: student.email,
    fullName: student.full_name,
    role,
    teeMemberId,
  };

  const token = createSessionJWT(sessionPayload);

  return {
    token,
    user: {
      carnet: student.carnet,
      fullName: student.full_name,
      email: student.email,
      role,
      sede: student.sede,
      career: student.career,
    },
  };
}
