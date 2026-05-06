export type E2ERole = 'admin' | 'voter';

export interface DbStudent {
  id: string;
  carnet: string;
  full_name: string;
  email: string;
  sede: string;
  career: string;
  degree_level: string;
}

export interface E2EUser {
  studentId: string;
  carnet: string;
  fullName: string;
  email: string;
  role: E2ERole;
  sede: string;
  career: string;
}

export interface StudentFixture {
  carnet: string;
  full_name: string;
  email: string;
  sede: string;
  career: string;
  degree_level: string;
}

export const seedSessionUsers: Record<E2ERole, E2EUser> = {
  admin: {
    studentId: '',
    carnet: '2024080534',
    fullName: 'Jose Fabian Zumbado Ruiz',
    email: 'j.zumbado.1@estudiantec.cr',
    role: 'admin',
    sede: 'Cartago',
    career: 'Ingenieria en Computacion',
  },
  voter: {
    studentId: '',
    carnet: '2024010001',
    fullName: 'Estudiante Prueba 01',
    email: 'prueba1@estudiantec.cr',
    role: 'voter',
    sede: 'San Jose',
    career: 'Ingenieria en Computacion',
  },
};

export const padronStudentFixture: StudentFixture = {
  carnet: '2099999001',
  full_name: 'E2E Padron Persona Base',
  email: 'e2e.padron.persona@estudiantec.cr',
  sede: 'Cartago',
  career: 'Ingenieria en Computacion',
  degree_level: 'Bachillerato',
};

export const auditStudentFixture = {
  resourceId: 'E2E_AUDIT_STUDENT_001',
  marker: 'E2E_AUDIT_TRACE',
  targetName: 'E2E Audit Persona',
  targetCarnet: '2099999201',
};

