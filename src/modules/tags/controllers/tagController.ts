import { Request, Response, NextFunction } from 'express';
import * as tagService from '../services/tagService';

function getRequestIp(req: Request): string | undefined {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string') {
    return forwardedFor.split(',')[0]?.trim();
  }
  if (Array.isArray(forwardedFor) && forwardedFor.length > 0) {
    return forwardedFor[0];
  }
  return req.ip || req.socket.remoteAddress;
}

function getAuditActor(req: Request) {
  return {
    id: req.user?.studentId,
    carnet: req.user?.carnet,
    ip: getRequestIp(req),
  };
}

export async function getTags(_req: Request, res: Response, next: NextFunction) {
  try {
    const tags = await tagService.getTags();
    res.json(tags);
  } catch (error) {
    next(error);
  }
}

export async function getTag(req: Request, res: Response, next: NextFunction) {
  try {
    const tag = await tagService.getTag(req.params.id as string);
    res.json(tag);
  } catch (error) {
    next(error);
  }
}

export async function createTag(req: Request, res: Response, next: NextFunction) {
  try {
    const tag = await tagService.createTag(req.body, getAuditActor(req));
    res.status(201).json(tag);
  } catch (error) {
    next(error);
  }
}

export async function updateTag(req: Request, res: Response, next: NextFunction) {
  try {
    const tag = await tagService.updateTag(req.params.id as string, req.body, getAuditActor(req));
    res.json(tag);
  } catch (error) {
    next(error);
  }
}

export async function deleteTag(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await tagService.deleteTag(req.params.id as string, getAuditActor(req));
    res.json(result);
  } catch (error) {
    next(error);
  }
}

