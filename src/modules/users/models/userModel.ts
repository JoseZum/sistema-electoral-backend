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

/**
 * Fila del padrón lista para `fn_import_students`. Las claves son las que espera
 * la función en el JSON, por eso van capitalizadas y en español.
 */
export interface PadronImportRow {
  Carnet: string;
  Nombre: string;
  Correo: string;
  Sede: string | null;
  Carrera: string | null;
  Grado: string;
}

export interface Admin {
  id: string;
  students_id: string;
  position_title: string;
  role: string;
  permissions: Record<string, boolean>;
  created_at: Date;
  updated_at: Date;
}
