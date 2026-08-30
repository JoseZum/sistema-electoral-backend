import { expect, test } from '@playwright/test';
import type { Pool } from 'pg';
import { createE2EPool, loadAdminUser, loadVoterUser } from '../helpers/db';
import {
  authHeaders,
  createSessionToken,
  seedStoredSession,
} from '../helpers/auth';
import { apiUrl, frontendUrl } from '../helpers/frontend';

test.describe.configure({ mode: 'serial', timeout: 120_000 });

test.describe('borrador administrativo de postulaciones', () => {
  let pool: Pool;
  let formId: string | null = null;

  test.beforeAll(() => {
    pool = createE2EPool();
  });

  test.afterAll(async () => {
    if (formId) {
      // El ID se obtuvo del INSERT de este mismo test; no toca datos ajenos.
      await pool.query('DELETE FROM application_forms WHERE id = $1', [formId]);
    }
    await pool.end();
  });

  test('se crea, edita, conserva y publica desde la interfaz real', async ({ page, request }) => {
    const [adminUser, voterUser] = await Promise.all([
      loadAdminUser(pool),
      loadVoterUser(pool),
    ]);
    const adminToken = createSessionToken(adminUser);
    const voterToken = createSessionToken(voterUser);
    const marker = `E2E borrador editable ${Date.now()}`;

    const createdResponse = await request.post(apiUrl('/api/postulaciones/formularios'), {
      headers: authHeaders(adminToken),
      data: {
        title: marker,
        description: 'Se debe poder continuar después de guardar.',
        status: 'DRAFT',
        voter_source: 'FULL_PADRON',
        positions: [],
      },
    });
    expect(createdResponse.ok()).toBeTruthy();
    const created = await createdResponse.json();
    formId = created.id;

    await seedStoredSession(page, adminUser);
    await page.goto(frontendUrl('/postulaciones'));

    const card = page.locator('.card').filter({ hasText: marker });
    await expect(card.getByText('Borrador', { exact: true })).toBeVisible();
    await card.getByRole('link', { name: 'Editar borrador' }).click();
    await expect(page).toHaveURL(new RegExp(`/postulaciones/${formId}/editar$`), {
      timeout: 30_000,
    });

    await page.getByLabel('Título del formulario').fill(`${marker} actualizado`);
    await page.getByLabel('Nombre del puesto nuevo').fill('Presidencia');
    await page.getByRole('button', { name: 'Agregar puesto' }).click();
    await expect(page.getByText('Presidencia', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Guardar borrador' }).click();

    await expect(page).toHaveURL(new RegExp(`/postulaciones/${formId}$`), { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: `${marker} actualizado` })).toBeVisible();
    await expect(page.getByText('Borrador', { exact: true })).toBeVisible();
    await expect(page.getByText('Presidencia', { exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'Editar borrador' }).click();
    await page.getByRole('button', { name: 'Publicar formulario' }).click();

    await expect(page).toHaveURL(new RegExp(`/postulaciones/${formId}$`), { timeout: 30_000 });
    await expect(page.getByText('Abierto', { exact: true })).toBeVisible();

    const voterFormsResponse = await request.get(apiUrl('/api/mis-postulaciones'), {
      headers: authHeaders(voterToken),
    });
    expect(voterFormsResponse.ok()).toBeTruthy();
    const voterForms = await voterFormsResponse.json();
    expect(voterForms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: formId, title: `${marker} actualizado`, status: 'OPEN' }),
      ])
    );
  });
});
