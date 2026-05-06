import path from 'node:path';
import type { FullConfig } from '@playwright/test';
import dotenv from 'dotenv';
import { writeStorageState } from '../helpers/auth';
import { createE2EPool, loadE2EUsers } from '../helpers/db';
import { FRONTEND_URL, waitForBackendHealth, waitForFrontendReady } from '../helpers/frontend';

dotenv.config();

export default async function globalSetup(_config: FullConfig): Promise<void> {
  await waitForBackendHealth();
  await waitForFrontendReady();

  if (!process.env.JWT_SECRET || !(process.env.E2E_DATABASE_URL || process.env.DATABASE_URL)) {
    return;
  }

  const pool = createE2EPool();

  try {
    const { adminUser, voterUser } = await loadE2EUsers(pool);
    const artifactDir = path.resolve(__dirname, '..', 'artifacts');

    await Promise.all([
      writeStorageState(path.join(artifactDir, 'admin.storageState.json'), adminUser, {
        frontendUrl: FRONTEND_URL,
      }),
      writeStorageState(path.join(artifactDir, 'voter.storageState.json'), voterUser, {
        frontendUrl: FRONTEND_URL,
      }),
    ]);
  } finally {
    await pool.end();
  }
}

