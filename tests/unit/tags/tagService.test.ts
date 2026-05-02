import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/modules/tags/repositories/tagRepository');
vi.mock('../../../src/config/database', () => ({
  pool: { connect: vi.fn() },
}));
vi.mock('../../../src/config/audit-context', () => ({
  withAuditContext: vi.fn(),
}));

import * as tagRepo from '../../../src/modules/tags/repositories/tagRepository';
import { withAuditContext } from '../../../src/config/audit-context';
import { pool } from '../../../src/config/database';
import {
  getTags,
  getTag,
  getTagById,
  createTag,
  updateTag,
  deleteTag,
} from '../../../src/modules/tags/services/tagService';
import { TagDetail, TagMember, TagSummary } from '../../../src/modules/tags/models/tagModel';
import { DEFAULT_TAG_COLOR, TAG_COLOR_VALUES } from '../../../src/modules/tags/constants/tagColors';

const VALID_COLOR = TAG_COLOR_VALUES[1];

const mockTag: TagSummary = {
  id: 'tag-uuid-1',
  name: 'Ciencias',
  description: 'Estudiantes de ciencias',
  color: DEFAULT_TAG_COLOR,
  member_count: 1,
  created_by: 'admin-uuid',
  created_at: new Date('2024-01-01'),
  updated_at: new Date('2024-01-02'),
};

const mockMember: TagMember = {
  tag_id: 'tag-uuid-1',
  id: 'student-uuid-1',
  carnet: '2021001234',
  full_name: 'Ana García',
  sede: 'Central',
  career: 'Ingeniería en Computación',
  degree_level: 'Bachillerato',
  is_active: true,
};

const mockDetail: TagDetail = { ...mockTag, members: [mockMember] };
const actor = { id: 'admin-uuid', carnet: '2021000000', ip: '127.0.0.1' };

describe('tagService', () => {
  let mockClient: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    };
    vi.mocked(withAuditContext).mockImplementation(async (_actor, fn) => fn(mockClient as any));
    vi.mocked(pool.connect).mockResolvedValue(mockClient as any);
  });

  // ─── getTags ───────────────────────────────────────────────────────────────

  describe('getTags', () => {
    it('returns all tags from repository', async () => {
      vi.mocked(tagRepo.findAllTags).mockResolvedValue([mockTag]);
      const result = await getTags();
      expect(result).toEqual([mockTag]);
      expect(tagRepo.findAllTags).toHaveBeenCalledOnce();
    });

    it('returns empty array when no tags exist', async () => {
      vi.mocked(tagRepo.findAllTags).mockResolvedValue([]);
      const result = await getTags();
      expect(result).toEqual([]);
    });
  });

  // ─── getTag ────────────────────────────────────────────────────────────────

  describe('getTag', () => {
    it('returns tag detail when tag exists', async () => {
      vi.mocked(tagRepo.getTagDetail).mockResolvedValue(mockDetail);
      const result = await getTag('tag-uuid-1');
      expect(result).toEqual(mockDetail);
      expect(tagRepo.getTagDetail).toHaveBeenCalledWith('tag-uuid-1');
    });

    it('throws when tag not found', async () => {
      vi.mocked(tagRepo.getTagDetail).mockResolvedValue(null);
      await expect(getTag('nonexistent')).rejects.toThrow('Tag no encontrada');
    });
  });

  // ─── getTagById ───────────────────────────────────────────────────────────

  describe('getTagById', () => {
    it('returns tag detail when tag exists', async () => {
      vi.mocked(tagRepo.getTagDetail).mockResolvedValue(mockDetail);
      const result = await getTagById('tag-uuid-1');
      expect(result).toEqual(mockDetail);
    });

    it('throws when tag not found', async () => {
      vi.mocked(tagRepo.getTagDetail).mockResolvedValue(null);
      await expect(getTagById('nonexistent')).rejects.toThrow('Tag no encontrada');
    });
  });

  // ─── createTag ────────────────────────────────────────────────────────────

  describe('createTag', () => {
    function setupCreateSuccess(studentIds = ['student-uuid-1']) {
      vi.mocked(tagRepo.findTagByName).mockResolvedValue(null);
      mockClient.query.mockResolvedValueOnce({
        rows: studentIds.map((id) => ({ id })),
        rowCount: studentIds.length,
      });
      vi.mocked(tagRepo.insertTag).mockResolvedValue(mockTag);
      vi.mocked(tagRepo.replaceTagMembers).mockResolvedValue(undefined as any);
      vi.mocked(tagRepo.getTagDetail).mockResolvedValue(mockDetail);
    }

    it('creates tag and returns detail', async () => {
      setupCreateSuccess();
      const result = await createTag({ name: 'Ciencias', student_ids: ['student-uuid-1'] }, actor);
      expect(result).toEqual(mockDetail);
    });

    it('calls insertTag with correct arguments', async () => {
      setupCreateSuccess();
      await createTag(
        { name: 'Ciencias', description: 'Desc', student_ids: ['student-uuid-1'] },
        actor
      );
      expect(tagRepo.insertTag).toHaveBeenCalledWith(
        { name: 'Ciencias', description: 'Desc', color: DEFAULT_TAG_COLOR },
        actor.id,
        mockClient
      );
    });

    it('uses default color when none provided', async () => {
      setupCreateSuccess();
      await createTag({ name: 'Ciencias', student_ids: ['student-uuid-1'] }, actor);
      expect(tagRepo.insertTag).toHaveBeenCalledWith(
        expect.objectContaining({ color: DEFAULT_TAG_COLOR }),
        expect.anything(),
        expect.anything()
      );
    });

    it('accepts and normalizes a valid color to uppercase', async () => {
      setupCreateSuccess();
      await createTag({ name: 'Ciencias', color: VALID_COLOR.toLowerCase(), student_ids: ['student-uuid-1'] }, actor);
      expect(tagRepo.insertTag).toHaveBeenCalledWith(
        expect.objectContaining({ color: VALID_COLOR }),
        expect.anything(),
        expect.anything()
      );
    });

    it('normalizes name by trimming whitespace', async () => {
      setupCreateSuccess();
      await createTag({ name: '  Ciencias  ', student_ids: ['student-uuid-1'] }, actor);
      expect(tagRepo.insertTag).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Ciencias' }),
        expect.anything(),
        expect.anything()
      );
    });

    it('normalizes name by collapsing inner spaces', async () => {
      setupCreateSuccess();
      await createTag({ name: 'Ciencias   Exactas', student_ids: ['student-uuid-1'] }, actor);
      expect(tagRepo.insertTag).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Ciencias Exactas' }),
        expect.anything(),
        expect.anything()
      );
    });

    it('deduplicates student_ids before validation', async () => {
      setupCreateSuccess(['student-uuid-1']);
      await createTag({ name: 'Ciencias', student_ids: ['student-uuid-1', 'student-uuid-1'] }, actor);
      const validationArgs = mockClient.query.mock.calls[0][1][0];
      expect(validationArgs).toEqual(['student-uuid-1']);
    });

    it('passes null description when not provided', async () => {
      setupCreateSuccess();
      await createTag({ name: 'Ciencias', student_ids: ['student-uuid-1'] }, actor);
      expect(tagRepo.insertTag).toHaveBeenCalledWith(
        expect.objectContaining({ description: null }),
        expect.anything(),
        expect.anything()
      );
    });

    it('throws when name is empty string', async () => {
      await expect(createTag({ name: '', student_ids: ['s1'] }, actor)).rejects.toThrow(
        'Se necesita un nombre para la tag'
      );
    });

    it('throws when name is only whitespace', async () => {
      await expect(createTag({ name: '   ', student_ids: ['s1'] }, actor)).rejects.toThrow(
        'Se necesita un nombre para la tag'
      );
    });

    it('throws when color is not in the allowed list', async () => {
      await expect(
        createTag({ name: 'Tag', color: '#FFFFFF', student_ids: ['s1'] }, actor)
      ).rejects.toThrow('Selecciona un color valido para la tag');
    });

    it('throws when student_ids is empty', async () => {
      vi.mocked(tagRepo.findTagByName).mockResolvedValue(null);
      await expect(createTag({ name: 'Tag', student_ids: [] }, actor)).rejects.toThrow(
        'Se necesita al menos un estudiante para crear la tag'
      );
    });

    it('throws when tag name already exists', async () => {
      vi.mocked(tagRepo.findTagByName).mockResolvedValue(mockTag);
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'student-uuid-1' }], rowCount: 1 });
      await expect(
        createTag({ name: 'Ciencias', student_ids: ['student-uuid-1'] }, actor)
      ).rejects.toThrow('Se necesita un nombre unico para la tag');
    });

    it('throws when a student ID is not found in padron', async () => {
      vi.mocked(tagRepo.findTagByName).mockResolvedValue(null);
      // returns only 1 of the 2 requested students
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'student-uuid-1' }], rowCount: 1 });
      await expect(
        createTag({ name: 'Ciencias', student_ids: ['student-uuid-1', 'bad-uuid'] }, actor)
      ).rejects.toThrow('Estudiante no encontrado en el padron');
    });

    it('calls replaceTagMembers with validated student IDs', async () => {
      setupCreateSuccess();
      await createTag({ name: 'Ciencias', student_ids: ['student-uuid-1'] }, actor);
      expect(tagRepo.replaceTagMembers).toHaveBeenCalledWith(
        mockTag.id,
        ['student-uuid-1'],
        mockClient
      );
    });
  });

  // ─── updateTag ────────────────────────────────────────────────────────────

  describe('updateTag', () => {
    function setupUpdateSuccess() {
      vi.mocked(tagRepo.findTagById).mockResolvedValue(mockTag);
      vi.mocked(tagRepo.findTagByName).mockResolvedValue(null);
      vi.mocked(tagRepo.updateTagRecord).mockResolvedValue(mockTag);
      vi.mocked(tagRepo.findTagMemberIds).mockResolvedValue(['student-uuid-1']);
      vi.mocked(tagRepo.deleteTagMembers).mockResolvedValue(undefined as any);
      vi.mocked(tagRepo.addTagMembers).mockResolvedValue(undefined as any);
      vi.mocked(tagRepo.getTagDetail).mockResolvedValue(mockDetail);
    }

    it('updates tag and returns detail', async () => {
      setupUpdateSuccess();
      const result = await updateTag('tag-uuid-1', { name: 'Nueva Tag' }, actor);
      expect(result).toEqual(mockDetail);
      expect(tagRepo.updateTagRecord).toHaveBeenCalled();
    });

    it('throws when tag not found', async () => {
      vi.mocked(tagRepo.findTagById).mockResolvedValue(null);
      await expect(updateTag('nonexistent', { name: 'Tag' }, actor)).rejects.toThrow(
        'Tag no encontrada'
      );
    });

    it('throws when empty name provided', async () => {
      await expect(updateTag('tag-uuid-1', { name: '' }, actor)).rejects.toThrow(
        'Se necesita un nombre para la tag'
      );
    });

    it('throws when whitespace-only name provided', async () => {
      await expect(updateTag('tag-uuid-1', { name: '   ' }, actor)).rejects.toThrow(
        'Se necesita un nombre para la tag'
      );
    });

    it('throws when color is invalid', async () => {
      await expect(
        updateTag('tag-uuid-1', { color: '#FFFFFF' }, actor)
      ).rejects.toThrow('Selecciona un color valido para la tag');
    });

    it('throws when name is already taken by a different tag', async () => {
      vi.mocked(tagRepo.findTagById).mockResolvedValue(mockTag);
      vi.mocked(tagRepo.findTagByName).mockResolvedValue({ ...mockTag, id: 'other-tag-id' });
      await expect(updateTag('tag-uuid-1', { name: 'Ciencias' }, actor)).rejects.toThrow(
        'Se necesita un nombre unico para la tag'
      );
    });

    it('allows renaming to the same name (same tag id)', async () => {
      vi.mocked(tagRepo.findTagById).mockResolvedValue(mockTag);
      vi.mocked(tagRepo.findTagByName).mockResolvedValue(mockTag); // same tag id
      vi.mocked(tagRepo.updateTagRecord).mockResolvedValue(mockTag);
      vi.mocked(tagRepo.getTagDetail).mockResolvedValue(mockDetail);
      const result = await updateTag('tag-uuid-1', { name: 'Ciencias' }, actor);
      expect(result).toEqual(mockDetail);
    });

    it('does not query members when student_ids is not in update payload', async () => {
      setupUpdateSuccess();
      await updateTag('tag-uuid-1', { name: 'Nueva' }, actor);
      expect(tagRepo.findTagMemberIds).not.toHaveBeenCalled();
      expect(tagRepo.deleteTagMembers).not.toHaveBeenCalled();
      expect(tagRepo.addTagMembers).not.toHaveBeenCalled();
    });

    it('adds new members and removes old ones when student_ids changes', async () => {
      vi.mocked(tagRepo.findTagById).mockResolvedValue(mockTag);
      vi.mocked(tagRepo.updateTagRecord).mockResolvedValue(mockTag);
      vi.mocked(tagRepo.findTagMemberIds).mockResolvedValue(['student-uuid-1']);
      vi.mocked(tagRepo.deleteTagMembers).mockResolvedValue(undefined as any);
      vi.mocked(tagRepo.addTagMembers).mockResolvedValue(undefined as any);
      vi.mocked(tagRepo.getTagDetail).mockResolvedValue(mockDetail);
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'student-uuid-2' }], rowCount: 1 });

      await updateTag('tag-uuid-1', { student_ids: ['student-uuid-2'] }, actor);

      expect(tagRepo.deleteTagMembers).toHaveBeenCalledWith('tag-uuid-1', ['student-uuid-1'], mockClient);
      expect(tagRepo.addTagMembers).toHaveBeenCalledWith('tag-uuid-1', ['student-uuid-2'], mockClient);
    });

    it('throws when updated student IDs contain invalid entries', async () => {
      vi.mocked(tagRepo.findTagById).mockResolvedValue(mockTag);
      // only 1 of 2 students is active
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'student-uuid-1' }], rowCount: 1 });
      await expect(
        updateTag('tag-uuid-1', { student_ids: ['student-uuid-1', 'bad-uuid'] }, actor)
      ).rejects.toThrow('Estudiante no encontrado en el padron');
    });

    it('throws when tag detail not found after update', async () => {
      vi.mocked(tagRepo.findTagById).mockResolvedValue(mockTag);
      vi.mocked(tagRepo.updateTagRecord).mockResolvedValue(mockTag);
      vi.mocked(tagRepo.getTagDetail).mockResolvedValue(null);
      await expect(updateTag('tag-uuid-1', { name: 'Nueva' }, actor)).rejects.toThrow(
        'Tag no encontrada'
      );
    });

    it('sets description to null when empty string provided', async () => {
      setupUpdateSuccess();
      await updateTag('tag-uuid-1', { description: '' }, actor);
      expect(tagRepo.updateTagRecord).toHaveBeenCalledWith(
        'tag-uuid-1',
        expect.objectContaining({ description: null }),
        mockClient
      );
    });
  });

  // ─── deleteTag ────────────────────────────────────────────────────────────

  describe('deleteTag', () => {
    it('returns { success: true } when tag is deleted', async () => {
      vi.mocked(tagRepo.deleteTag).mockResolvedValue(true);
      const result = await deleteTag('tag-uuid-1', actor);
      expect(result).toEqual({ success: true });
    });

    it('calls deleteTag repository with correct id and client', async () => {
      vi.mocked(tagRepo.deleteTag).mockResolvedValue(true);
      await deleteTag('tag-uuid-1', actor);
      expect(tagRepo.deleteTag).toHaveBeenCalledWith('tag-uuid-1', mockClient);
    });

    it('throws when tag not found', async () => {
      vi.mocked(tagRepo.deleteTag).mockResolvedValue(false);
      await expect(deleteTag('nonexistent', actor)).rejects.toThrow('Tag no encontrada');
    });

    it('uses pool.connect when no actor provided', async () => {
      vi.mocked(tagRepo.deleteTag).mockResolvedValue(true);
      await deleteTag('tag-uuid-1');
      expect(pool.connect).toHaveBeenCalled();
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('rolls back and releases client on error (no actor path)', async () => {
      vi.mocked(tagRepo.deleteTag).mockResolvedValue(false);
      await expect(deleteTag('tag-uuid-1')).rejects.toThrow('Tag no encontrada');
      const queryCalls = mockClient.query.mock.calls.map((c) => c[0] as string);
      expect(queryCalls).toContain('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });
});
