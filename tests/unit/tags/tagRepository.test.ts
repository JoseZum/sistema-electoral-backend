import { describe, it, expect, vi } from 'vitest';
import {
  findAllTags,
  findTagById,
  findTagByName,
  findTagMembers,
  findTagMemberIds,
  findActiveStudentIdsByIds,
  insertTag,
  updateTagRecord,
  replaceTagMembers,
  addTagMembers,
  deleteTagMembers,
  deleteTag,
  getTagDetail,
} from '../../../src/modules/tags/repositories/tagRepository';
import { TagSummary, TagMember } from '../../../src/modules/tags/models/tagModel';

const mockTag: TagSummary = {
  id: 'uuid-1',
  name: 'Ciencias',
  description: 'Estudiantes de ciencias',
  color: '#FF0000',
  member_count: 2,
  created_by: 'admin-uuid',
  created_at: new Date('2024-01-01'),
  updated_at: new Date('2024-01-02'),
};

const mockMember: TagMember = {
  tag_id: 'uuid-1',
  id: 'student-uuid-1',
  carnet: '2021001234',
  full_name: 'Ana García',
  sede: 'Central',
  career: 'Ingeniería en Computación',
  degree_level: 'Bachillerato',
  is_active: true,
};

function makeDb(rows: unknown[], rowCount = rows.length) {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount }) };
}

describe('tagRepository', () => {
  describe('findAllTags', () => {
    it('returns all tags from db', async () => {
      const db = makeDb([mockTag]);
      const result = await findAllTags(db as any);
      expect(result).toEqual([mockTag]);
      expect(db.query).toHaveBeenCalledOnce();
    });

    it('returns empty array when no tags exist', async () => {
      const db = makeDb([]);
      const result = await findAllTags(db as any);
      expect(result).toEqual([]);
    });
  });

  describe('findTagById', () => {
    it('returns tag when found', async () => {
      const db = makeDb([mockTag]);
      const result = await findTagById('uuid-1', db as any);
      expect(result).toEqual(mockTag);
      expect(db.query).toHaveBeenCalledWith(expect.any(String), ['uuid-1']);
    });

    it('returns null when tag not found', async () => {
      const db = makeDb([]);
      const result = await findTagById('nonexistent', db as any);
      expect(result).toBeNull();
    });
  });

  describe('findTagByName', () => {
    it('returns tag when name matches', async () => {
      const db = makeDb([mockTag]);
      const result = await findTagByName('Ciencias', db as any);
      expect(result).toEqual(mockTag);
      expect(db.query).toHaveBeenCalledWith(expect.any(String), ['Ciencias']);
    });

    it('returns null when name not found', async () => {
      const db = makeDb([]);
      const result = await findTagByName('NoExiste', db as any);
      expect(result).toBeNull();
    });
  });

  describe('findTagMembers', () => {
    it('returns members of a tag', async () => {
      const db = makeDb([mockMember]);
      const result = await findTagMembers('uuid-1', db as any);
      expect(result).toEqual([mockMember]);
      expect(db.query).toHaveBeenCalledWith(expect.any(String), ['uuid-1']);
    });

    it('returns empty array when tag has no members', async () => {
      const db = makeDb([]);
      const result = await findTagMembers('uuid-1', db as any);
      expect(result).toEqual([]);
    });
  });

  describe('findTagMemberIds', () => {
    it('returns student IDs for a tag', async () => {
      const db = makeDb([{ student_id: 'student-uuid-1' }, { student_id: 'student-uuid-2' }]);
      const result = await findTagMemberIds('uuid-1', db as any);
      expect(result).toEqual(['student-uuid-1', 'student-uuid-2']);
    });

    it('returns empty array when tag has no members', async () => {
      const db = makeDb([]);
      const result = await findTagMemberIds('uuid-1', db as any);
      expect(result).toEqual([]);
    });
  });

  describe('findActiveStudentIdsByIds', () => {
    it('returns active student IDs that match the input list', async () => {
      const db = makeDb([{ id: 'student-uuid-1' }]);
      const result = await findActiveStudentIdsByIds(['student-uuid-1', 'student-uuid-2'], db as any);
      expect(result).toEqual(['student-uuid-1']);
      expect(db.query).toHaveBeenCalledWith(expect.any(String), [['student-uuid-1', 'student-uuid-2']]);
    });

    it('returns empty array without querying db when input is empty', async () => {
      const db = makeDb([]);
      const result = await findActiveStudentIdsByIds([], db as any);
      expect(result).toEqual([]);
      expect(db.query).not.toHaveBeenCalled();
    });
  });

  describe('insertTag', () => {
    it('inserts a tag and returns the created record', async () => {
      const newTag = { ...mockTag, member_count: 0 };
      const db = makeDb([newTag]);
      const result = await insertTag({ name: 'Ciencias', color: '#FF0000' }, 'admin-uuid', db as any);
      expect(result).toEqual(newTag);
      expect(db.query).toHaveBeenCalledWith(
        expect.any(String),
        ['Ciencias', null, '#FF0000', 'admin-uuid']
      );
    });

    it('uses null for description and createdBy when not provided', async () => {
      const db = makeDb([mockTag]);
      await insertTag({ name: 'Ciencias', color: '#FF0000' }, undefined, db as any);
      expect(db.query).toHaveBeenCalledWith(expect.any(String), ['Ciencias', null, '#FF0000', null]);
    });

    it('passes description when provided', async () => {
      const db = makeDb([mockTag]);
      await insertTag({ name: 'Ciencias', description: 'Desc', color: '#FF0000' }, null, db as any);
      expect(db.query).toHaveBeenCalledWith(expect.any(String), ['Ciencias', 'Desc', '#FF0000', null]);
    });
  });

  describe('updateTagRecord', () => {
    it('updates provided fields and returns updated tag', async () => {
      const db = makeDb([{ ...mockTag, name: 'Letras' }]);
      const result = await updateTagRecord('uuid-1', { name: 'Letras' }, db as any);
      expect(result?.name).toBe('Letras');
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE tags'), ['Letras', 'uuid-1']);
    });

    it('returns null when tag not found during update', async () => {
      const db = makeDb([]);
      const result = await updateTagRecord('nonexistent', { name: 'X' }, db as any);
      expect(result).toBeNull();
    });

    it('calls findTagById when no fields are provided', async () => {
      const db = makeDb([mockTag]);
      const result = await updateTagRecord('uuid-1', {}, db as any);
      expect(result).toEqual(mockTag);
      expect(db.query).toHaveBeenCalledOnce();
    });

    it('builds SET clause with multiple fields', async () => {
      const db = makeDb([{ ...mockTag, name: 'Nueva', color: '#00FF00' }]);
      await updateTagRecord('uuid-1', { name: 'Nueva', color: '#00FF00' }, db as any);
      const sql: string = db.query.mock.calls[0][0];
      expect(sql).toContain('name = $1');
      expect(sql).toContain('color = $2');
    });

    it('includes description = null in update when explicitly set to null', async () => {
      const db = makeDb([{ ...mockTag, description: null }]);
      await updateTagRecord('uuid-1', { description: null }, db as any);
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining('description = $1'), [null, 'uuid-1']);
    });
  });

  describe('replaceTagMembers', () => {
    it('deletes existing members and inserts new ones', async () => {
      const db = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
      await replaceTagMembers('uuid-1', ['student-uuid-1'], db as any);
      expect(db.query).toHaveBeenCalledTimes(2);
      expect(db.query).toHaveBeenNthCalledWith(1, expect.stringContaining('DELETE'), ['uuid-1']);
      expect(db.query).toHaveBeenNthCalledWith(2, expect.stringContaining('INSERT'), [['uuid-1'], ['student-uuid-1']]);
    });

    it('only deletes when studentIds is empty', async () => {
      const db = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
      await replaceTagMembers('uuid-1', [], db as any);
      expect(db.query).toHaveBeenCalledOnce();
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining('DELETE'), ['uuid-1']);
    });
  });

  describe('addTagMembers', () => {
    it('inserts members with ON CONFLICT DO NOTHING', async () => {
      const db = makeDb([]);
      await addTagMembers('uuid-1', ['student-uuid-1', 'student-uuid-2'], db as any);
      expect(db.query).toHaveBeenCalledOnce();
      const sql: string = db.query.mock.calls[0][0];
      expect(sql).toContain('ON CONFLICT');
      expect(sql).toContain('DO NOTHING');
    });

    it('does not query db when studentIds is empty', async () => {
      const db = makeDb([]);
      await addTagMembers('uuid-1', [], db as any);
      expect(db.query).not.toHaveBeenCalled();
    });
  });

  describe('deleteTagMembers', () => {
    it('deletes specified members from a tag', async () => {
      const db = makeDb([], 1);
      await deleteTagMembers('uuid-1', ['student-uuid-1'], db as any);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM tag_members'),
        ['uuid-1', ['student-uuid-1']]
      );
    });

    it('does not query db when studentIds is empty', async () => {
      const db = makeDb([]);
      await deleteTagMembers('uuid-1', [], db as any);
      expect(db.query).not.toHaveBeenCalled();
    });
  });

  describe('deleteTag', () => {
    it('returns true when tag was deleted', async () => {
      const db = makeDb([], 1);
      const result = await deleteTag('uuid-1', db as any);
      expect(result).toBe(true);
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM tags'), ['uuid-1']);
    });

    it('returns false when tag was not found', async () => {
      const db = makeDb([], 0);
      const result = await deleteTag('nonexistent', db as any);
      expect(result).toBe(false);
    });
  });

  describe('getTagDetail', () => {
    it('returns tag with members when tag exists', async () => {
      const db = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [mockTag], rowCount: 1 })
          .mockResolvedValueOnce({ rows: [mockMember], rowCount: 1 }),
      };
      const result = await getTagDetail('uuid-1', db as any);
      expect(result).toEqual({ ...mockTag, members: [mockMember] });
      expect(db.query).toHaveBeenCalledTimes(2);
    });

    it('returns null when tag does not exist', async () => {
      const db = makeDb([]);
      const result = await getTagDetail('nonexistent', db as any);
      expect(result).toBeNull();
      expect(db.query).toHaveBeenCalledOnce();
    });

    it('returns tag with empty members array when tag has no members', async () => {
      const db = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [mockTag], rowCount: 1 })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }),
      };
      const result = await getTagDetail('uuid-1', db as any);
      expect(result).toEqual({ ...mockTag, members: [] });
    });
  });
});
