import { Router } from 'express';
import { authenticate } from '../../../middleware/authenticate';
import { requireAdmin } from '../../../middleware/requireAdmin';
import * as notificationsController from '../controllers/notificationsController';

const router = Router();

router.use(authenticate);
router.use(requireAdmin);

router.post('/send', notificationsController.sendNotifications);

export default router;