export interface CreateAdminDto {
  students_id: string;
  position_title: string;
  role?: string;
  permissions?: Record<string, boolean>;
}

export interface UpdateAdminDto {
  position_title?: string;
  role?: string;
  permissions?: Record<string, boolean>;
  is_active?: boolean;
}
