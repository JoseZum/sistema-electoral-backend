import { Router } from 'express';
import { authenticate } from '../../../middleware/authenticate';
import { requireAdmin } from '../../../middleware/requireAdmin';
import * as tagController from '../controllers/tagController';

const router = Router();

router.use(authenticate);
router.use(requireAdmin);

router.get('/', tagController.getTags);
router.post('/', tagController.createTag);
router.get('/:id', tagController.getTag);
router.put('/:id', tagController.updateTag);
router.delete('/:id', tagController.deleteTag);

export default router;

