export interface Student {
  id: string;
  carnet: string;
  full_name: string;
  email: string;
  sede: string;
  career: string;
  degree_level: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface Admin {
  id: string;
  students_id: string;
  position_title: string;
  role: string;
  permissions: Record<string, boolean>;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}
