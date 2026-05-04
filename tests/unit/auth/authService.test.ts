import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/modules/auth/services/microsoftTokenService');
vi.mock('../../../src/modules/users/repositories/studentRepository');
vi.mock('../../../src/modules/users/repositories/adminRepository');
vi.mock('../../../src/modules/auth/services/jwtUtils');

import * as microsoftTokenService from '../../../src/modules/auth/services/microsoftTokenService';
import { authenticateWithMicrosoft } from '../../../src/modules/auth/services/authService';
import * as studentRepository from '../../../src/modules/users/repositories/studentRepository';
import * as adminRepository from '../../../src/modules/users/repositories/adminRepository';
import * as jwtUtils from '../../../src/modules/auth/services/jwtUtils';
import { AppError } from '../../../src/errors/appError';
import type { Admin, Student } from '../../../src/modules/users/models/userModel';

describe('authService', () => {
  const mockStudent: Student = {
    id: 'student-1',
    carnet: '2020123456',
    full_name: 'Jane Student',
    email: 'student@estudiantec.cr',
    sede: 'Central',
    career: 'Ingenieria en Computacion',
    degree_level: 'Bachillerato',
    is_active: true,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-02T00:00:00.000Z'),
  };

  const mockAdmin: Admin = {
    id: 'admin-1',
    students_id: mockStudent.id,
    position_title: 'TEE Admin',
    role: 'admin',
    permissions: {},
    created_at: new Date('2026-01-03T00:00:00.000Z'),
    updated_at: new Date('2026-01-04T00:00:00.000Z'),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(microsoftTokenService.verifyMicrosoftIdToken).mockResolvedValue({
      iss: 'https://login.microsoftonline.com/tenant-id/v2.0',
      sub: 'microsoft-subject-id',
      aud: 'azure-client-id',
      exp: 1_735_689_600,
      iat: 1_735_660_800,
      email: 'student@estudiantec.cr',
    });
    vi.mocked(studentRepository.findStudentByEmail).mockResolvedValue(mockStudent);
    vi.mocked(adminRepository.findAdminByStudentId).mockResolvedValue(null);
    vi.mocked(jwtUtils.createSessionJWT).mockReturnValue('signed-session-jwt');
  });

  it('authenticates a voter and returns a session response', async () => {
    const result = await authenticateWithMicrosoft('microsoft-id-token');

    expect(microsoftTokenService.verifyMicrosoftIdToken).toHaveBeenCalledWith('microsoft-id-token');
    expect(studentRepository.findStudentByEmail).toHaveBeenCalledWith('student@estudiantec.cr');
    expect(adminRepository.findAdminByStudentId).toHaveBeenCalledWith(mockStudent.id);
    expect(jwtUtils.createSessionJWT).toHaveBeenCalledWith({
      studentId: mockStudent.id,
      carnet: mockStudent.carnet,
      email: mockStudent.email,
      fullName: mockStudent.full_name,
      role: 'voter',
    });
    expect(result).toEqual({
      token: 'signed-session-jwt',
      user: {
        studentId: mockStudent.id,
        carnet: mockStudent.carnet,
        fullName: mockStudent.full_name,
        email: mockStudent.email,
        role: 'voter',
        sede: mockStudent.sede,
        career: mockStudent.career,
      },
    });
  });

  it('uses preferred_username when email is missing and normalizes it for lookup', async () => {
    vi.mocked(microsoftTokenService.verifyMicrosoftIdToken).mockResolvedValue({
      iss: 'https://login.microsoftonline.com/tenant-id/v2.0',
      sub: 'microsoft-subject-id',
      aud: 'azure-client-id',
      exp: 1_735_689_600,
      iat: 1_735_660_800,
      preferred_username: 'STUDENT@ESTUDIANTEC.CR',
    });

    await authenticateWithMicrosoft('microsoft-id-token');

    expect(studentRepository.findStudentByEmail).toHaveBeenCalledWith('student@estudiantec.cr');
  });

  it('authenticates an admin when the student has an admin record', async () => {
    vi.mocked(adminRepository.findAdminByStudentId).mockResolvedValue(mockAdmin);

    const result = await authenticateWithMicrosoft('microsoft-id-token');

    expect(jwtUtils.createSessionJWT).toHaveBeenCalledWith({
      studentId: mockStudent.id,
      carnet: mockStudent.carnet,
      email: mockStudent.email,
      fullName: mockStudent.full_name,
      role: 'admin',
    });
    expect(result.user.role).toBe('admin');
  });

  it('rejects Microsoft tokens without email claims', async () => {
    vi.mocked(microsoftTokenService.verifyMicrosoftIdToken).mockResolvedValue({
      iss: 'https://login.microsoftonline.com/tenant-id/v2.0',
      sub: 'microsoft-subject-id',
      aud: 'azure-client-id',
      exp: 1_735_689_600,
      iat: 1_735_660_800,
    });

    await expect(authenticateWithMicrosoft('microsoft-id-token')).rejects.toMatchObject({
      status: 401,
      code: 'AUTH_EMAIL_MISSING',
    });
    expect(studentRepository.findStudentByEmail).not.toHaveBeenCalled();
    expect(jwtUtils.createSessionJWT).not.toHaveBeenCalled();
  });

  it('rejects Microsoft accounts outside the estudiantec domain', async () => {
    vi.mocked(microsoftTokenService.verifyMicrosoftIdToken).mockResolvedValue({
      iss: 'https://login.microsoftonline.com/tenant-id/v2.0',
      sub: 'microsoft-subject-id',
      aud: 'azure-client-id',
      exp: 1_735_689_600,
      iat: 1_735_660_800,
      email: 'student@example.com',
    });

    await expect(authenticateWithMicrosoft('microsoft-id-token')).rejects.toMatchObject({
      status: 403,
      code: 'AUTH_DOMAIN_NOT_ALLOWED',
    });
    expect(studentRepository.findStudentByEmail).not.toHaveBeenCalled();
    expect(jwtUtils.createSessionJWT).not.toHaveBeenCalled();
  });

  it('rejects valid Microsoft users missing from the electoral padron', async () => {
    vi.mocked(studentRepository.findStudentByEmail).mockResolvedValue(null);

    await expect(authenticateWithMicrosoft('microsoft-id-token')).rejects.toMatchObject({
      status: 404,
      code: 'AUTH_STUDENT_NOT_FOUND',
    });
    expect(adminRepository.findAdminByStudentId).not.toHaveBeenCalled();
    expect(jwtUtils.createSessionJWT).not.toHaveBeenCalled();
  });

  it('propagates Microsoft token verification errors', async () => {
    const error = new AppError({
      status: 401,
      code: 'AUTH_TOKEN_INVALID',
      message: 'Autenticacion fallida: token de Microsoft invalido.',
    });
    vi.mocked(microsoftTokenService.verifyMicrosoftIdToken).mockRejectedValue(error);

    await expect(authenticateWithMicrosoft('invalid-token')).rejects.toBe(error);
    expect(studentRepository.findStudentByEmail).not.toHaveBeenCalled();
    expect(jwtUtils.createSessionJWT).not.toHaveBeenCalled();
  });
});
