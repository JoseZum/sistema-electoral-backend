import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import type { E2EUser } from '../fixtures/users';
import { frontendOrigin, FRONTEND_URL } from './frontend';

export interface SessionTokenOptions {
  jwtSecret?: string;
  expiresIn?: SignOptions['expiresIn'];
  includeStudentId?: boolean;
}

export interface StorageState {
  cookies: Array<Record<string, unknown>>;
  origins: Array<{
    origin: string;
    localStorage: Array<{
      name: string;
      value: string;
    }>;
  }>;
}

export function getJwtSecret(secret = process.env.JWT_SECRET): string {
  if (!secret) {
    throw new Error(
      'JWT_SECRET is required to create E2E storage sessions. Set it to the same value used by the backend.'
    );
  }

  return secret;
}

export function createSessionToken(user: E2EUser, options: SessionTokenOptions = {}): string {
  const includeStudentId = options.includeStudentId ?? Boolean(user.studentId);
  const payload = {
    ...(includeStudentId && user.studentId ? { studentId: user.studentId } : {}),
    carnet: user.carnet,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
  };

  const signOptions: SignOptions = {
    expiresIn: options.expiresIn || '8h',
    issuer: 'tee-voting-system',
  };

  return jwt.sign(payload, getJwtSecret(options.jwtSecret), signOptions);
}

export function authHeaders(token: string): { Authorization: string } {
  return {
    Authorization: `Bearer ${token}`,
  };
}

export async function seedStoredSession(
  page: Page,
  user: E2EUser,
  options: SessionTokenOptions = {}
): Promise<void> {
  const token = createSessionToken(user, options);

  await page.addInitScript(
    ({ storageToken, storageUser }) => {
      window.localStorage.setItem('tee_token', storageToken);
      window.localStorage.setItem('tee_user', JSON.stringify(storageUser));
    },
    {
      storageToken: token,
      storageUser: user,
    }
  );
}

export function buildStorageState(
  user: E2EUser,
  {
    frontendUrl = FRONTEND_URL,
    ...tokenOptions
  }: SessionTokenOptions & { frontendUrl?: string } = {}
): StorageState {
  const token = createSessionToken(user, tokenOptions);

  return {
    cookies: [],
    origins: [
      {
        origin: frontendOrigin(frontendUrl),
        localStorage: [
          { name: 'tee_token', value: token },
          { name: 'tee_user', value: JSON.stringify(user) },
        ],
      },
    ],
  };
}

export async function writeStorageState(
  outputPath: string,
  user: E2EUser,
  options: SessionTokenOptions & { frontendUrl?: string } = {}
): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(
    outputPath,
    `${JSON.stringify(buildStorageState(user, options), null, 2)}\n`,
    'utf8'
  );
}
