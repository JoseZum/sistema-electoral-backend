import request from 'supertest';
import app from '../../src/index';

describe('GET /api/health', () => {
  it('returns 200 and health payload', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(typeof response.body.timestamp).toBe('string');
  });
});
