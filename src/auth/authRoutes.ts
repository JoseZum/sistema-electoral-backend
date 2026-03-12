import { Router } from 'express';
import { microsoftAuthHandler } from './authController';

const router = Router();

router.post('/microsoft', microsoftAuthHandler);

export default router;
