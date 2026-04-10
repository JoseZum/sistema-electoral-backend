import {Response, Request, NextFunction } from 'express';
import { ScrutinyInfo } from '../models/scrutiny.types'
import * as scrutinyService from '../services/scrutinyService'


export async function operativeStatusElection(req:Request, res: Response, next: NextFunction) {
    try{
        const infoElections = await scrutinyService.getOperativeStateElection(req.params.electionId as string); 
        res.json(infoElections);
    }catch(error){
        next(error);
    }
};

// Assing members to an elections.


export async function assingMembersElection(req:Request, res: Response, next: NextFunction) {
    try {
        const result = await scrutinyService.addMembersElection(req.params.electionId as string, req.body, req.user?.studentId);
        res.status(201).json(result);
    } catch (error){
        next(error);
    }

    
};


export async function submitKey(req:Request, res: Response, next: NextFunction) {
    try {
        const result = await scrutinyService.submitKey({
            election_id: req.params.electionId as string, 
            member_id: req.body.memberId,
            key_shard: req.body.key
        })
        res.status(201).json(result);
    } catch (error) {
        next(error)
    }
};

export async function resultsScrutiny(req: Request, res: Response, next: NextFunction) {
    try {
        const result = await scrutinyService.scrutinyResult(req.params.electionId as string);
        res.status(201).json(result);
    } catch (error) {
        next(error)
    }
    
}

export async function finalizedElection(req: Request, res: Response, next: NextFunction) {
    try {
        const result = await scrutinyService.finaleElection(req.params.electionId as string, req.user?.studentId);
        res.status(201).json(result);
    } catch (error) {
        next(error);
    }
    
}