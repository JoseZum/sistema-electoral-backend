import { Router } from 'express';
import { authenticate } from '../../../middleware/authenticate';
import {requireAdmin} from '../../../middleware/requireAdmin';
import * as scrutinyController from '../controllers/scrutinyController';
import { validateBody, validateUuidParam } from '../../../middleware/validateRequest';
import { assignMembersSchema, submitKeySchema } from '../schemas/scrutinySchemas';

const router = Router();

router.use(authenticate);
router.use(requireAdmin);
router.param('electionId', validateUuidParam);

// Progress operartive election.
router.get('/:electionId', scrutinyController.operativeStatusElection);
router.get('/:electionId/results', scrutinyController.resultsScrutiny);

router.post('/:electionId/submit-key', validateBody(submitKeySchema), scrutinyController.submitKey);
router.post('/:electionId/assign-members', validateBody(assignMembersSchema), scrutinyController.assingMembersElection);
router.post('/:electionId/finalize', scrutinyController.finalizedElection);

export default router;
