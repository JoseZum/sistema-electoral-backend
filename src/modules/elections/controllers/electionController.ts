import { Request, Response, NextFunction } from 'express';
import * as electionService from '../services/electionService';

type IdParam = { id: string };
type IdOptionParam = { id: string; optionId: string };

export async function getElections(_req: Request, res: Response, next: NextFunction) {
  try {
    const elections = await electionService.getAllElections();
    res.json(elections);
  } catch (error) {
    next(error);
  }
}

export async function getElectionById(req: Request<IdParam>, res: Response, next: NextFunction) {
  try {
    const election = await electionService.getElectionById(req.params.id);
    res.json(election);
  } catch (error) {
    next(error);
  }
}

export async function createElection(req: Request, res: Response, next: NextFunction) {
  try {
    const election = await electionService.createElection(req.body, req.admin?.id);
    res.status(201).json(election);
  } catch (error) {
    next(error);
  }
}

export async function updateElection(req: Request<IdParam>, res: Response, next: NextFunction) {
  try {
    const election = await electionService.updateElection(req.params.id, req.body, {
      id: req.admin?.id,
      carnet: req.user?.carnet,
      ip: req.ip || req.headers['x-forwarded-for'] as string || req.socket.remoteAddress,
    });
    res.json(election);
  } catch (error) {
    next(error);
  }
}

export async function deleteElection(req: Request<IdParam>, res: Response, next: NextFunction) {
  try {
    const result = await electionService.deleteElection(req.params.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function changeStatus(req: Request<IdParam>, res: Response, next: NextFunction) {
  try {
    const election = await electionService.changeStatus(req.params.id, req.body.status, {
      id: req.admin?.id,
      carnet: req.user?.carnet,
      ip: req.ip || req.headers['x-forwarded-for'] as string || req.socket.remoteAddress,
    });
    res.json(election);
  } catch (error) {
    next(error);
  }
}

// Options
export async function addOption(req: Request<IdParam>, res: Response, next: NextFunction) {
  try {
    const option = await electionService.addOption(req.params.id, req.body);
    res.status(201).json(option);
  } catch (error) {
    next(error);
  }
}

export async function updateOption(req: Request<IdOptionParam>, res: Response, next: NextFunction) {
  try {
    const option = await electionService.updateOption(req.params.id, req.params.optionId, req.body, {
      id: req.admin?.id,
      carnet: req.user?.carnet,
      ip: req.ip || req.headers['x-forwarded-for'] as string || req.socket.remoteAddress,
    });
    res.json(option);
  } catch (error) {
    next(error);
  }
}

export async function deleteOption(req: Request<IdOptionParam>, res: Response, next: NextFunction) {
  try {
    const result = await electionService.deleteOption(req.params.id, req.params.optionId);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

// Voters
export async function populateVoters(req: Request<IdParam>, res: Response, next: NextFunction) {
  try {
    const result = await electionService.populateVoters(req.params.id, req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function clearVoters(req: Request<IdParam>, res: Response, next: NextFunction) {
  try {
    const result = await electionService.clearVoters(req.params.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

// Results
export async function getResults(req: Request<IdParam>, res: Response, next: NextFunction) {
  try {
    const results = await electionService.getResults(req.params.id);
    res.json(results);
  } catch (error) {
    next(error);
  }
}
