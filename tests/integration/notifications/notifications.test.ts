import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';

const mocks = vi.hoisted(() => ({
  verifySessionJWT: vi.fn(),
  findAdminByStudentId: vi.fn(),
  findElectionById: vi.fn(),
  getVoterEmailsByElection: vi.fn(),
  sendMail: vi.fn(),
  createTransport: vi.fn(),
}));
vi.mock('../../../src/modules/auth/services/jwtUtils', () => ({ verifySessionJWT: mocks.verifySessionJWT }));
vi.mock('../../../src/modules/users/repositories/adminRepository', () => ({ findAdminByStudentId: mocks.findAdminByStudentId }));
vi.mock('../../../src/modules/elections/repositories/electionRepository', () => ({ findElectionById: mocks.findElectionById }));
vi.mock('../../../src/modules/notifications/repositories/notificationRepository', () => ({ notificationRepository: { getVoterEmailsByElection: mocks.getVoterEmailsByElection } }));
vi.mock('nodemailer', () => ({ default: { createTransport: mocks.createTransport } }));

import notificationRoutes from '../../../src/modules/notifications/routes/notificationsRoutes';
import { errorHandler } from '../../../src/middleware/errorHandler';

describe('notifications integration', () => {
  let server: Server;
  let url: string;
  const electionId = '11111111-1111-4111-8111-111111111111';
  const payload = { electionId, emailType: 'reminder' };

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/notifications', notificationRoutes);
    app.use(errorHandler);
    server = await new Promise<Server>((resolve) => {
      const running = app.listen(0, '127.0.0.1', () => resolve(running));
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test server address');
    url = `http://127.0.0.1:${address.port}/api/notifications/send`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('SMTP_HOST', 'smtp.example.test');
    vi.stubEnv('SMTP_FROM', 'tee@example.test');
    vi.stubEnv('SMTP_PORT', '587');
    vi.stubEnv('SMTP_USER', '');
    vi.stubEnv('SMTP_PASS', '');
    mocks.verifySessionJWT.mockReturnValue({ studentId: 'admin-1' });
    mocks.findAdminByStudentId.mockResolvedValue({ id: 'admin-1' });
    mocks.findElectionById.mockResolvedValue({ title: 'Elección estudiantil', status: 'OPEN', end_time: new Date('2026-09-20T18:00:00Z') });
    mocks.getVoterEmailsByElection.mockResolvedValue([{ email: 'first@example.test' }, { email: 'second@example.test' }]);
    mocks.sendMail.mockReset().mockResolvedValue({ accepted: ['recipient'] });
    mocks.createTransport.mockReturnValue({ sendMail: mocks.sendMail });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  async function send(body: unknown = payload, authenticated = true) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: 'Bearer test-token' } : {}) },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }

  it('rejects unauthenticated users and non-administrators before sending', async () => {
    expect((await send(payload, false)).status).toBe(401);
    mocks.findAdminByStudentId.mockResolvedValue(null);
    expect((await send()).status).toBe(403);
    expect(mocks.createTransport).not.toHaveBeenCalled();
  });

  it.each([
    { ...payload, electionId: 'invalid' },
    { ...payload, emailType: 'token' },
    { ...payload, emailType: 'custom', message: '  ' },
    { ...payload, message: 'x'.repeat(5001) },
  ])('rejects invalid input before contacting SMTP (%j)', async (body) => {
    expect((await send(body)).status).toBe(400);
    expect(mocks.createTransport).not.toHaveBeenCalled();
  });

  it('returns 503 when SMTP is not configured', async () => {
    vi.stubEnv('SMTP_HOST', '');
    expect(await send()).toMatchObject({ status: 503, body: { code: 'SMTP_NOT_CONFIGURED' } });
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });

  it('rejects a missing election, a closed reminder, and an empty recipient list', async () => {
    mocks.findElectionById.mockResolvedValueOnce(null);
    expect((await send()).status).toBe(404);
    mocks.findElectionById.mockResolvedValueOnce({ status: 'CLOSED' });
    expect((await send()).status).toBe(409);
    mocks.getVoterEmailsByElection.mockResolvedValue([]);
    expect((await send()).status).toBe(400);
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });

  it('sends separate messages with the election template and no shared recipients', async () => {
    expect(await send()).toMatchObject({ status: 200, body: { total: 2 } });
    expect(mocks.createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: 'smtp.example.test', requireTLS: true }));
    expect(mocks.sendMail).toHaveBeenCalledTimes(2);
    expect(mocks.sendMail).toHaveBeenNthCalledWith(1, expect.objectContaining({ to: 'first@example.test', text: expect.stringContaining('Elección estudiantil') }));
    expect(mocks.sendMail).toHaveBeenNthCalledWith(2, expect.objectContaining({ to: 'second@example.test', text: expect.stringContaining('Microsoft') }));
  });

  it('sends custom text and reports a partial failure without claiming full success', async () => {
    mocks.sendMail.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('SMTP unavailable'));
    expect(await send({ ...payload, emailType: 'custom', message: 'Aviso del TEE' })).toMatchObject({
      status: 502, body: { code: 'SMTP_SEND_FAILED', meta: { sent: 1, total: 2 } },
    });
    expect(mocks.sendMail).toHaveBeenNthCalledWith(1, expect.objectContaining({ text: 'Aviso del TEE' }));
  });
});
