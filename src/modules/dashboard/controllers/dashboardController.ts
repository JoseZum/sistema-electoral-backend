import { Request, Response, NextFunction } from 'express';
import * as service from '../services/dashboardService';

export async function getStats(req: Request, res: Response, next: NextFunction) {
  try {
    const stats = await service.getStats();
    res.json(stats);
  } catch (error) {
    next(error);
  }
}