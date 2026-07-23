import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  logger,
  redactLogValue,
  sanitizeUrlPath,
} from '../../../src/observability/logger';

describe('observability logger privacy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('removes query strings from request URLs', () => {
    expect(
      sanitizeUrlPath('/api/users?search=student@estudiantec.cr&carnet=2024012345')
    ).toBe('/api/users');
  });

  it('redacts sensitive keys and PII embedded in strings', () => {
    const value = redactLogValue({
      authorization: 'Bearer secret',
      details: 'Key (email)=(student@estudiantec.cr) already exists',
      message:
        'student@estudiantec.cr carnet 2024012345 token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature',
      nested: { password: 'unsafe-password' },
    });

    expect(value).toEqual({
      authorization: '[REDACTED]',
      details: '[REDACTED]',
      message:
        '[REDACTED_EMAIL] carnet [REDACTED_CARNET] token [REDACTED_TOKEN]',
      nested: { password: '[REDACTED]' },
    });
  });

  it('never emits raw PII in structured logs', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    logger.error('Database failure for student@estudiantec.cr', {
      url: '/api/users',
      details: 'Key (carnet)=(2024012345) already exists',
      stack: 'secret stack',
    });

    const emitted = String(errorSpy.mock.calls[0]?.[0]);
    expect(emitted).not.toContain('student@estudiantec.cr');
    expect(emitted).not.toContain('2024012345');
    expect(emitted).not.toContain('secret stack');
    expect(JSON.parse(emitted)).toMatchObject({
      msg: 'Database failure for [REDACTED_EMAIL]',
      url: '/api/users',
      details: '[REDACTED]',
      stack: '[REDACTED]',
    });
  });
});
