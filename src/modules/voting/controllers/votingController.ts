import { Request, Response, NextFunction } from 'express';
import * as votingService from '../services/votingService';

export async function getMyElections(req: Request, res: Response, next: NextFunction) {
  try {
    const email = req.user?.email;
    if (!email) { res.status(401).json({ error: 'No autenticado' }); return; }
    const elections = await votingService.getMyElections(email);
    res.json(elections);
  } catch (error) {
    next(error);
  }
}

export async function getElectionDetail(req: Request, res: Response, next: NextFunction) {
  try {
    const email = req.user?.email;
    if (!email) { res.status(401).json({ error: 'No autenticado' }); return; }
    const election = await votingService.getElectionForVoting(req.params.id as string, email);
    res.json(election);
  } catch (error) {
    next(error);
  }
}

export async function requestToken(req: Request, res: Response, next: NextFunction) {
  try {
    const email = req.user?.email;
    if (!email) { res.status(401).json({ error: 'No autenticado' }); return; }
    const tokenResponse = await votingService.requestVoteToken(
      req.params.id as string,
      email,
      req.body.code,
      req.body.carnet
    );
    res.json(tokenResponse);
  } catch (error) {
    next(error);
  }
}

export async function castVote(req: Request, res: Response, next: NextFunction) {
  try {
    const email = req.user?.email;
    if (!email) { res.status(401).json({ error: 'No autenticado' }); return; }
    const result = await votingService.castVote({
      electionId: req.body.electionId,
      optionId: req.body.optionId,
      token: req.body.token,
    }, email);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function getResults(req: Request, res: Response, next: NextFunction) {
  try {
    const email = req.user?.email;
    if (!email) { res.status(401).json({ error: 'No autenticado' }); return; }
    const results = await votingService.getResults(req.params.id as string, email);
    res.json(results);
  } catch (error) {
    next(error);
  }
}
