export interface TagSummary {
  id: string;
  name: string;
  description: string | null;
  color: string;
  member_count: number;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface TagMember {
  tag_id: string;
  id: string;
  carnet: string;
  full_name: string;
  sede: string;
  career: string;
  degree_level: string;
  is_active: boolean;
}

export interface TagDetail extends TagSummary {
  members: TagMember[];
}

export interface CreateTagDto {
  name: string;
  description?: string;
  color?: string;
  student_ids: string[];
}

export interface UpdateTagDto {
  name?: string;
  description?: string;
  color?: string;
  student_ids?: string[];
}
