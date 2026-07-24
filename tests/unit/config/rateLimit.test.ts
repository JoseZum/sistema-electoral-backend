import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { getGeneralRateLimitKey } from '../../../src/config/rate-limit';

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
