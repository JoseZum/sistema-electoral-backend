export interface CreateStudentDto {
  carnet: string;
  full_name: string;
  email: string;
  sede: string;
  career: string;
  degree_level: string;
}

export interface UpdateStudentDto {
  full_name?: string;
  email?: string;
  sede?: string;
  career?: string;
  degree_level?: string;
  is_active?: boolean;
}

export interface StudentFiltersDto {
  sede?: string;
  career?: string;
  is_active?: boolean;
  search?: string;
  page?: number;
  limit?: number;
}
