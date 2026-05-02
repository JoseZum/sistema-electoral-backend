import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';

vi.mock('../../../src/modules/tags/services/tagService');

import * as tagService from '../../../src/modules/tags/services/tagService';
import {
  getTags,
  getTag,
  createTag,
  updateTag,
  deleteTag,
} from '../../../src/modules/tags/controllers/tagController';
import { TagDetail, TagSummary } from '../../../src/modules/tags/models/tagModel';
import { DEFAULT_TAG_COLOR } from '../../../src/modules/tags/constants/tagColors';

const mockTag: TagSummary = {
  id: 'tag-uuid-1',
  name: 'Ciencias',
  description: 'Desc',
  color: DEFAULT_TAG_COLOR,
  member_count: 1,
  created_by: 'admin-uuid',
  created_at: new Date('2024-01-01'),
  updated_at: new Date('2024-01-02'),
};

const mockDetail: TagDetail = {
  ...mockTag,
  members: [
    {
      tag_id: 'tag-uuid-1',
      id: 'student-uuid-1',
      carnet: '2021001234',
      full_name: 'Ana García',
      sede: 'Central',
      career: 'Ingeniería en Computación',
      degree_level: 'Bachillerato',
      is_active: true,
    },
  ],
};

function makeRes(): Response {
  const res = {} as any;
  res.json = vi.fn().mockReturnValue(res);
  res.status = vi.fn().mockReturnValue(res);
  return res as Response;
}

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    params: {},
    body: {},
    headers: {},
    user: undefined,
    ip: undefined,
    socket: { remoteAddress: undefined },
    ...overrides,
  } as unknown as Request;
}

function makeNext(): NextFunction {
  return vi.fn() as unknown as NextFunction;
}

describe('tagController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── getTags ──────────────────────────────────────────────────────────────

  describe('getTags', () => {
    it('responds with all tags as JSON', async () => {
      vi.mocked(tagService.getTags).mockResolvedValue([mockTag]);
      const res = makeRes();
      await getTags(makeReq(), res, makeNext());
      expect(tagService.getTags).toHaveBeenCalledOnce();
      expect(res.json).toHaveBeenCalledWith([mockTag]);
    });

    it('calls next with error when service throws', async () => {
      const error = new Error('DB error');
      vi.mocked(tagService.getTags).mockRejectedValue(error);
      const next = makeNext();
      await getTags(makeReq(), makeRes(), next);
      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // ─── getTag ───────────────────────────────────────────────────────────────

  describe('getTag', () => {
    it('responds with the tag detail as JSON', async () => {
      vi.mocked(tagService.getTag).mockResolvedValue(mockDetail);
      const res = makeRes();
      const req = makeReq({ params: { id: 'tag-uuid-1' } });
      await getTag(req, res, makeNext());
      expect(tagService.getTag).toHaveBeenCalledWith('tag-uuid-1');
      expect(res.json).toHaveBeenCalledWith(mockDetail);
    });

    it('calls next with error when service throws', async () => {
      vi.mocked(tagService.getTag).mockRejectedValue(new Error('Tag no encontrada'));
      const next = makeNext();
      await getTag(makeReq({ params: { id: 'bad-id' } }), makeRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  // ─── createTag ────────────────────────────────────────────────────────────

  describe('createTag', () => {
    it('responds with 201 and the created tag', async () => {
      vi.mocked(tagService.createTag).mockResolvedValue(mockDetail);
      const res = makeRes();
      const body = { name: 'Ciencias', student_ids: ['student-uuid-1'] };
      await createTag(makeReq({ body }), res, makeNext());
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(mockDetail);
    });

    it('passes req.body to the service', async () => {
      vi.mocked(tagService.createTag).mockResolvedValue(mockDetail);
      const body = { name: 'Tag', student_ids: ['s1'] };
      await createTag(makeReq({ body }), makeRes(), makeNext());
      expect(tagService.createTag).toHaveBeenCalledWith(body, expect.any(Object));
    });

    it('builds actor from req.user and req.ip', async () => {
      vi.mocked(tagService.createTag).mockResolvedValue(mockDetail);
      const req = makeReq({
        body: {},
        user: { studentId: 'admin-uuid', carnet: '2021000000' } as any,
        ip: '10.0.0.1',
      });
      await createTag(req, makeRes(), makeNext());
      expect(tagService.createTag).toHaveBeenCalledWith(
        expect.anything(),
        { id: 'admin-uuid', carnet: '2021000000', ip: '10.0.0.1' }
      );
    });

    it('calls next with error when service throws', async () => {
      vi.mocked(tagService.createTag).mockRejectedValue(new Error('Nombre duplicado'));
      const next = makeNext();
      await createTag(makeReq(), makeRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  // ─── updateTag ────────────────────────────────────────────────────────────

  describe('updateTag', () => {
    it('responds with the updated tag as JSON', async () => {
      vi.mocked(tagService.updateTag).mockResolvedValue(mockDetail);
      const res = makeRes();
      const req = makeReq({ params: { id: 'tag-uuid-1' }, body: { name: 'Nueva' } });
      await updateTag(req, res, makeNext());
      expect(tagService.updateTag).toHaveBeenCalledWith('tag-uuid-1', { name: 'Nueva' }, expect.any(Object));
      expect(res.json).toHaveBeenCalledWith(mockDetail);
    });

    it('builds actor from req.user and x-forwarded-for header (string)', async () => {
      vi.mocked(tagService.updateTag).mockResolvedValue(mockDetail);
      const req = makeReq({
        params: { id: 'tag-uuid-1' },
        body: {},
        user: { studentId: 'admin-uuid', carnet: '2021000000' } as any,
        headers: { 'x-forwarded-for': '192.168.1.1, 10.0.0.1' },
      });
      await updateTag(req, makeRes(), makeNext());
      expect(tagService.updateTag).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { id: 'admin-uuid', carnet: '2021000000', ip: '192.168.1.1' }
      );
    });

    it('builds actor using x-forwarded-for header when it is an array', async () => {
      vi.mocked(tagService.updateTag).mockResolvedValue(mockDetail);
      const req = makeReq({
        params: { id: 'tag-uuid-1' },
        body: {},
        user: { studentId: 'admin-uuid', carnet: '2021000000' } as any,
        headers: { 'x-forwarded-for': ['172.16.0.1', '10.0.0.1'] as any },
      });
      await updateTag(req, makeRes(), makeNext());
      expect(tagService.updateTag).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ ip: '172.16.0.1' })
      );
    });

    it('falls back to req.socket.remoteAddress when no ip headers present', async () => {
      vi.mocked(tagService.updateTag).mockResolvedValue(mockDetail);
      const req = makeReq({
        params: { id: 'tag-uuid-1' },
        body: {},
        socket: { remoteAddress: '127.0.0.1' } as any,
      });
      await updateTag(req, makeRes(), makeNext());
      expect(tagService.updateTag).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ ip: '127.0.0.1' })
      );
    });

    it('calls next with error when service throws', async () => {
      vi.mocked(tagService.updateTag).mockRejectedValue(new Error('Tag no encontrada'));
      const next = makeNext();
      await updateTag(makeReq({ params: { id: 'bad-id' } }), makeRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  // ─── deleteTag ────────────────────────────────────────────────────────────

  describe('deleteTag', () => {
    it('responds with the service result as JSON', async () => {
      vi.mocked(tagService.deleteTag).mockResolvedValue({ success: true });
      const res = makeRes();
      await deleteTag(makeReq({ params: { id: 'tag-uuid-1' } }), res, makeNext());
      expect(tagService.deleteTag).toHaveBeenCalledWith('tag-uuid-1', expect.any(Object));
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });

    it('calls next with error when service throws', async () => {
      vi.mocked(tagService.deleteTag).mockRejectedValue(new Error('Tag no encontrada'));
      const next = makeNext();
      await deleteTag(makeReq({ params: { id: 'bad-id' } }), makeRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});
