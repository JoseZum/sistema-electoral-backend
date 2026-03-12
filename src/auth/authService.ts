import { verifyMicrosoftIdToken } from './microsoftTokenService';
import { findStudentByEmail } from '../user/studentRepository';
import { findTeeMemberByCarnet } from '../user/teeMemberRepository';
import { createSessionJWT } from './jwtUtils';
import { AuthResponse, SessionJWTPayload } from './authModel';

const ALLOWED_DOMAIN = '@estudiantec.cr';

export async function authenticateWithMicrosoft(idToken: string): Promise<AuthResponse> {
  // 1. Verificar token de Microsoft ID
  const claims = await verifyMicrosoftIdToken(idToken);

  const email = claims.email || claims.preferred_username;
  if (!email) {
    throw new Error('No email found in token claims');
  }

  // 2. Validar dominio @estudiantec.cr
  if (!email.toLowerCase().endsWith(ALLOWED_DOMAIN)) {
    throw new Error('Only @estudiantec.cr accounts are allowed');
  }

  // 3. Buscar estudiante en el padrón
  const student = await findStudentByEmail(email.toLowerCase());
  if (!student) {
    throw new Error('Student not found in the electoral registry. Please contact TEE.');
  }

  // 4. Chequear si es miembro del TEE
  let role: SessionJWTPayload['role'] = 'voter';
  let teeMemberId: string | undefined;

  const teeMember = await findTeeMemberByCarnet(student.carnet);
  if (teeMember) {
    role = teeMember.role as SessionJWTPayload['role'];
    teeMemberId = teeMember.id;
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
