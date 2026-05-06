export type ElectionStatus = 'DRAFT' | 'SCHEDULED' | 'OPEN' | 'CLOSED' | 'SCRUTINIZED' | 'ARCHIVED';
export type VoterSource = 'FULL_PADRON' | 'FILTERED' | 'MANUAL' | 'TAG';

export const electionPrefix = 'E2E Elections';

export const electionFixture = {
  title: `${electionPrefix} Base`,
  updatedTitle: `${electionPrefix} Actualizada`,
  uiTitle: `${electionPrefix} UI Principal`,
  description: 'Eleccion deterministica para pruebas E2E de elecciones',
  updatedDescription: 'Eleccion actualizada por pruebas E2E',
  optionA: `${electionPrefix} Opcion A`,
  optionB: `${electionPrefix} Opcion B`,
  optionC: `${electionPrefix} Opcion C`,
};

export const votingPrefix = 'E2E Voting';

export const votingFixture = {
  title: `${votingPrefix} Nominal Abierta`,
  anonymousTitle: `${votingPrefix} Anonima Abierta`,
  closedTitle: `${votingPrefix} Cerrada`,
  uiTitle: `${votingPrefix} UI`,
  description: 'Eleccion deterministica para pruebas E2E de votacion',
  optionA: `${votingPrefix} Opcion A`,
  optionB: `${votingPrefix} Opcion B`,
};

export const scrutinyPrefix = 'E2E Scrutiny';

export const scrutinyFixture = {
  title: `${scrutinyPrefix} Cerrada con Llaves`,
  description: 'Eleccion deterministica para pruebas E2E de escrutinio',
  options: ['E2E Scrutiny Opcion A', 'E2E Scrutiny Opcion B'],
};

