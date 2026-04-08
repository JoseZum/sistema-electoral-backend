import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/modules/auth/services/microsoftTokenService', () => ({
  verifyMicrosoftIdToken: vi.fn(),
}));

vi.mock('../../src/modules/users/repositories/studentRepository', () => ({
  findStudentByEmail: vi.fn(),
}));

vi.mock('../../src/modules/users/repositories/adminRepository', () => ({
  findAdminByStudentId: vi.fn(),
}));

vi.mock('../../src/modules/auth/services/jwtUtils', () => ({
  createSessionJWT: vi.fn(),
}));

import { authenticateWithMicrosoft } from '../../src/modules/auth/services/authService';
import { verifyMicrosoftIdToken } from '../../src/modules/auth/services/microsoftTokenService';
import { findStudentByEmail } from '../../src/modules/users/repositories/studentRepository';
import { findAdminByStudentId } from '../../src/modules/users/repositories/adminRepository';
import { createSessionJWT } from '../../src/modules/auth/services/jwtUtils';

describe('authService.authenticateWithMicrosoft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('authenticates a valid student and assigns admin role when applicable', async () => {
    vi.mocked(verifyMicrosoftIdToken).mockResolvedValue({
      iss: 'https://login.microsoftonline.com',
      sub: 'sub-1',
      aud: 'aud-1',
      exp: 123,
      iat: 123,
      email: 'admin@estudiantec.cr',
    });

    vi.mocked(findStudentByEmail).mockResolvedValue({
      id: 'student-1',
      carnet: 'A001',
      full_name: 'Admin User',
      email: 'admin@estudiantec.cr',
      sede: 'Central',
      career: 'Informatica',
      degree_level: 'Bachillerato',
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    });

    vi.mocked(findAdminByStudentId).mockResolvedValue({
      id: 'admin-1',
      students_id: 'student-1',
      position_title: 'Presidencia',
      role: 'admin',
      permissions: {},
      created_at: new Date(),
      updated_at: new Date(),
    });

    vi.mocked(createSessionJWT).mockReturnValue('jwt-token');

    const result = await authenticateWithMicrosoft('id-token');

    expect(verifyMicrosoftIdToken).toHaveBeenCalledWith('id-token');
    expect(findStudentByEmail).toHaveBeenCalledWith('admin@estudiantec.cr');
    expect(findAdminByStudentId).toHaveBeenCalledWith('student-1');
    expect(createSessionJWT).toHaveBeenCalledTimes(1);
    expect(result.token).toBe('jwt-token');
    expect(result.user.role).toBe('admin');
  });

  it('rejects emails outside allowed domain', async () => {
    vi.mocked(verifyMicrosoftIdToken).mockResolvedValue({
      iss: 'https://login.microsoftonline.com',
      sub: 'sub-2',
      aud: 'aud-1',
      exp: 123,
      iat: 123,
      email: 'user@gmail.com',
    });

    await expect(authenticateWithMicrosoft('id-token')).rejects.toThrow(
      'Solo se permiten cuentas @estudiantec.cr'
    );

    expect(findStudentByEmail).not.toHaveBeenCalled();
  });

  it('fails when student does not exist in padron', async () => {
    vi.mocked(verifyMicrosoftIdToken).mockResolvedValue({
      iss: 'https://login.microsoftonline.com',
      sub: 'sub-3',
      aud: 'aud-1',
      exp: 123,
      iat: 123,
      email: 'missing@estudiantec.cr',
    });

    vi.mocked(findStudentByEmail).mockResolvedValue(null);

    await expect(authenticateWithMicrosoft('id-token')).rejects.toThrow(
      'Estudiante no encontrado en el padrón electoral. Contacte al TEE.'
    );
  });
});
