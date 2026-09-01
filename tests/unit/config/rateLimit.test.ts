import { afterEach, describe, expect, it } from 'vitest';
import express, { type Request } from 'express';
import type { AddressInfo, Server } from 'net';
import {
  createAuthLimiter,
  getAuthRateLimitKey,
  getGeneralRateLimitKey,
} from '../../../src/config/rate-limit';

function request(input: {
  authorization?: string;
  ip?: string;
  remoteAddress?: string;
}): Request {
  return {
    headers: { authorization: input.authorization },
    ip: input.ip,
    socket: { remoteAddress: input.remoteAddress },
  } as Request;
}

describe('getGeneralRateLimitKey', () => {
  it('separates authenticated sessions that share the same IP', () => {
    const first = getGeneralRateLimitKey(request({ authorization: 'Bearer token-a', ip: '10.0.0.1' }));
    const second = getGeneralRateLimitKey(request({ authorization: 'Bearer token-b', ip: '10.0.0.1' }));

    expect(first).toMatch(/^session:[a-f0-9]{64}$/);
    expect(second).toMatch(/^session:[a-f0-9]{64}$/);
    expect(first).not.toBe(second);
    expect(first).not.toContain('token-a');
  });

  it('uses the client IP when no bearer session exists', () => {
    expect(getGeneralRateLimitKey(request({ ip: '192.0.2.10' }))).toBe('ip:192.0.2.10');
  });

  it('falls back to the socket address when Express has no resolved IP', () => {
    expect(getGeneralRateLimitKey(request({ remoteAddress: '127.0.0.1' }))).toBe('ip:127.0.0.1');
  });
});

describe('getAuthRateLimitKey', () => {
  it('always groups by IP, even when a bearer token is present', () => {
    // Si mirara el Authorization, bastaria un bearer distinto por intento para estrenar una
    // cubeta nueva y evadir el limitador de login.
    const withBearer = getAuthRateLimitKey(
      request({ authorization: 'Bearer attacker-supplied', ip: '10.0.0.1' })
    );

    expect(withBearer).toBe('ip:10.0.0.1');
  });

  it('gives the same key to different bearers coming from one IP', () => {
    const first = getAuthRateLimitKey(request({ authorization: 'Bearer a', ip: '10.0.0.1' }));
    const second = getAuthRateLimitKey(request({ authorization: 'Bearer b', ip: '10.0.0.1' }));

    expect(first).toBe(second);
  });

  it('falls back to the socket address when Express has no resolved IP', () => {
    expect(getAuthRateLimitKey(request({ remoteAddress: '127.0.0.1' }))).toBe('ip:127.0.0.1');
  });
});

describe('createAuthLimiter', () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      if (!server) {
        resolve();
        return;
      }
      server.close(() => resolve());
    });
    server = undefined;
  });

  /** Levanta /login con el limitador real; `outcome` fija si el login sale bien o mal. */
  async function startLoginServer(outcome: 'success' | 'failure', max: number): Promise<string> {
    const app = express();
    app.use('/login', createAuthLimiter({ windowMs: 60_000, max }));
    app.post('/login', (_req, res) => {
      if (outcome === 'success') {
        res.status(200).json({ ok: true });
        return;
      }
      res.status(401).json({ code: 'AUTH_TOKEN_INVALID' });
    });

    server = app.listen(0);
    await new Promise<void>((resolve) => server?.once('listening', () => resolve()));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}/login`;
  }

  async function statuses(url: string, attempts: number): Promise<number[]> {
    const codes: number[] = [];
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const response = await fetch(url, { method: 'POST' });
      codes.push(response.status);
    }
    return codes;
  }

  it('never throttles successful logins sharing one IP (campus behind NAT)', async () => {
    const url = await startLoginServer('success', 3);

    // Muy por encima del limite: un pico de votantes legitimos no debe recibir un solo 429.
    expect(await statuses(url, 20)).not.toContain(429);
  });

  it('still throttles failed logins once the limit is reached', async () => {
    const url = await startLoginServer('failure', 3);

    expect(await statuses(url, 5)).toEqual([401, 401, 401, 429, 429]);
  });
});
