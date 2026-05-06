import { Router } from 'express';
import { authenticate } from '../../../middleware/authenticate';
import { requireAdmin } from '../../../middleware/requireAdmin';
import { getStats } from '../controllers/dashboardController';

const router = Router();

router.use(authenticate);
router.use(requireAdmin);

router.get('/stats', getStats);

export default router;
