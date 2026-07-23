import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

const metricsMocks = vi.hoisted(() => ({
  recordHttpRequest: vi.fn(),
}));

vi.mock('../../../src/observability/metrics', () => metricsMocks);

import { metricsMiddleware } from '../../../src/middleware/metricsMiddleware';

describe('metricsMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records a normalized route without request identifiers', () => {
    let finish: (() => void) | undefined;
    const req = {
      method: 'GET',
      baseUrl: '/api/elections',
      route: { path: '/:id' },
    } as Request;
    const res = {
      statusCode: 200,
      on: vi.fn((event: string, callback: () => void) => {
        if (event === 'finish') finish = callback;
        return res;
      }),
    } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;

    metricsMiddleware(req, res, next);
    finish?.();

    expect(next).toHaveBeenCalledOnce();
    expect(metricsMocks.recordHttpRequest).toHaveBeenCalledWith(
      {
        http_method: 'GET',
        route: '/api/elections/:id',
        status_code: 200,
        status_class: '2xx',
      },
      expect.any(Number)
    );
  });
});
