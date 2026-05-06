import type { StudentFixture } from './users';

export const tagPrefix = 'E2E Tag';

export const tagFixture = {
  name: `${tagPrefix} Base`,
  updatedName: `${tagPrefix} Actualizada`,
  uiName: `${tagPrefix} UI`,
  uiUpdatedName: `${tagPrefix} UI Editada`,
  description: 'Grupo deterministico para pruebas E2E',
  color: '#00695C',
  updatedColor: '#283593',
};

export const tagStudentFixtures: StudentFixture[] = [
  {
    carnet: '2099999101',
    full_name: 'E2E Tags Persona Uno',
    email: 'e2e.tags.persona.uno@estudiantec.cr',
    sede: 'Cartago',
    career: 'Ingenieria en Computacion',
    degree_level: 'Bachillerato',
  },
  {
    carnet: '2099999102',
    full_name: 'E2E Tags Persona Dos',
    email: 'e2e.tags.persona.dos@estudiantec.cr',
    sede: 'Cartago',
    career: 'Ingenieria en Computacion',
    degree_level: 'Bachillerato',
  },
];

