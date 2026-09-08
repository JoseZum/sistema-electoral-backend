import { Router } from 'express';
import { authenticate } from '../../../middleware/authenticate';
import { requireAdmin } from '../../../middleware/requireAdmin';
import * as tagController from '../controllers/tagController';
import { validateBody, validateUuidParam } from '../../../middleware/validateRequest';
import { createTagSchema, updateTagSchema, tagErrors } from '../schemas/tagSchemas';

const router = Router();

router.use(authenticate);
router.use(requireAdmin);
router.param('id', validateUuidParam);

router.get('/', tagController.getTags);
router.post('/', validateBody(createTagSchema, tagErrors), tagController.createTag);
router.get('/:id', tagController.getTag);
router.put('/:id', validateBody(updateTagSchema, tagErrors), tagController.updateTag);
router.delete('/:id', tagController.deleteTag);

export default router;
