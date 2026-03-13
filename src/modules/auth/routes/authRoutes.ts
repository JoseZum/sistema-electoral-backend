import { Router } from 'express';
import { microsoftAuthHandler } from '../controllers/authController';

const router = Router();

router.post('/microsoft', microsoftAuthHandler);

export default router;
