import { expect, test, type Page } from '@playwright/test';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';

dotenv.config();

const FRONTEND_URL =
  process.env.E2E_FRONTEND_URL ||
  process.env.PLAYWRIGHT_BASE_URL ||
  'http://localhost:3000';

const BACKEND_URL =
  process.env.E2E_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:3001';

type E2ERole = 'admin' | 'voter';

interface E2EUser {
  studentId: string;
  carnet: string;
  fullName: string;
  email: string;
  role: E2ERole;
  sede: string;
  career: string;
}

const e2eUsers: Record<E2ERole, E2EUser> = {
  admin: {
    studentId: 'e2e-admin-session',
    carnet: '2024080534',
    fullName: 'Jose Fabian Zumbado Ruiz',
    email: 'j.zumbado.1@estudiantec.cr',
    role: 'admin',
    sede: 'Cartago',
    career: 'Ingenieria en Computacion',
  },
  voter: {
    studentId: 'e2e-voter-session',
    carnet: '2024010001',
    fullName: 'Estudiante Prueba 01',
    email: 'prueba1@estudiantec.cr',
    role: 'voter',
    sede: 'San Jose',
    career: 'Ingenieria en Computacion',
  },
};

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      'JWT_SECRET is required to create E2E storage sessions. Set it to the same value used by the backend.'
    );
  }
  return secret;
}

function createSessionToken(user: E2EUser): string {
  const { carnet, email, fullName, role } = user;

  return jwt.sign(
    {
      carnet,
      email,
      fullName,
      role,
    },
    getJwtSecret(),
    {
      expiresIn: '8h',
      issuer: 'tee-voting-system',
    }
  );
}

async function seedStoredSession(page: Page, user: E2EUser): Promise<void> {
  const token = createSessionToken(user);

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

test.describe('auth e2e', () => {
  test('backend healthcheck is available for the E2E stack', async ({ request }) => {
    const response = await request.get(`${BACKEND_URL}/api/health`);
    const body = await response.json();

    expect(response.ok()).toBeTruthy();
    expect(body).toEqual(expect.objectContaining({ status: 'ok' }));
  });

  test('login page exposes the Microsoft institutional entry point', async ({ page }) => {
    await page.goto(FRONTEND_URL);

    await expect(page.getByRole('heading', { name: /Portal de votaci.n/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Continuar con Microsoft/i })).toBeVisible();
    await expect(page.getByText(/Acceso institucional del TEE/i)).toBeVisible();
  });

  test('anonymous users are redirected away from the admin area', async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/padron`);

    await expect(page).toHaveURL(new RegExp(`${FRONTEND_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?$`));
    await expect(page.getByRole('button', { name: /Continuar con Microsoft/i })).toBeVisible();
  });

  test('stored admin session opens the administrative padron and reaches the backend', async ({ page }) => {
    await seedStoredSession(page, e2eUsers.admin);
    await page.goto(FRONTEND_URL);

    await expect(page).toHaveURL(/\/padron$/);
    await expect(page.getByRole('heading', { name: /Padr.n Estudiantil/i })).toBeVisible();
    await expect(page.getByText(e2eUsers.admin.fullName)).toBeVisible();
    await expect(page.getByText(/estudiantes activos/i)).toBeVisible();
  });

  test('stored voter session opens the voter election list and reaches the backend', async ({ page }) => {
    await seedStoredSession(page, e2eUsers.voter);
    await page.goto(FRONTEND_URL);

    await expect(page).toHaveURL(/\/votaciones$/);
    await expect(page.getByRole('heading', { name: /Tus votaciones/i })).toBeVisible();
    await expect(page.getByText(e2eUsers.voter.fullName)).toBeVisible();
    await expect(page.getByRole('button', { name: /Todas \(/i })).toBeVisible();
  });

  test('backend rejects malformed Microsoft auth requests without calling the provider', async ({ request }) => {
    const missingToken = await request.post(`${BACKEND_URL}/api/auth/microsoft`, {
      data: {},
    });
    const missingTokenBody = await missingToken.json();

    expect(missingToken.status()).toBe(400);
    expect(missingTokenBody).toEqual(
      expect.objectContaining({
        code: 'AUTH_INVALID_REQUEST',
        error: 'Falta el idToken o es invalido en el cuerpo de la peticion.',
      })
    );

    const invalidJson = await request.post(`${BACKEND_URL}/api/auth/microsoft`, {
      data: '{',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    const invalidJsonBody = await invalidJson.json();

    expect(invalidJson.status()).toBe(400);
    expect(invalidJsonBody).toEqual(
      expect.objectContaining({
        code: 'INVALID_JSON_BODY',
        error: 'El cuerpo de la peticion no es JSON valido.',
      })
    );
  });

  test('real Microsoft idToken can be exchanged for the backend session contract', async ({ request }) => {
    test.skip(
      !process.env.E2E_MICROSOFT_ID_TOKEN,
      'Set E2E_MICROSOFT_ID_TOKEN to exercise the real Microsoft -> backend exchange.'
    );

    const response = await request.post(`${BACKEND_URL}/api/auth/microsoft`, {
      data: {
        idToken: process.env.E2E_MICROSOFT_ID_TOKEN,
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();

    expect(body).toEqual(
      expect.objectContaining({
        token: expect.any(String),
        user: expect.objectContaining({
          email: expect.stringMatching(/@estudiantec\.cr$/),
          role: expect.stringMatching(/^(admin|voter)$/),
        }),
      })
    );
  });
});
