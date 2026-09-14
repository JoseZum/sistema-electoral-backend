import { Router } from 'express';
import { authenticate } from '../../../middleware/authenticate';
import { requireAdmin } from '../../../middleware/requireAdmin';
import * as notificationsController from '../controllers/notificationsController';
import { validateBody } from '../../../middleware/validateRequest';
import { sendNotificationSchema } from '../models/notificationModel';

const router = Router();

router.use(authenticate);
router.use(requireAdmin);

router.post('/send', validateBody(sendNotificationSchema), notificationsController.sendNotifications);

export default router;
