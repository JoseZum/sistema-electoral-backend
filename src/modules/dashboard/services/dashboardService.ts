import * as repo from '../repositories/dashboardRepository';

export async function getStats() {
  return repo.getStats();
}