import { Request, Response, NextFunction } from 'express';
import { notificationsService } from '../services/notificationsService';

export async function sendNotifications(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const result = await notificationsService.sendNotifications(req.body);
        res.json(result);
    } catch (error) {
        next(error);
    }
}