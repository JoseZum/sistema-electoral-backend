import { Router } from 'express';
import { authenticate } from '../../../middleware/authenticate';
import {requireAdmin} from '../../../middleware/requireAdmin';
import * as scrutinyController from '../controllers/scrutinyController';

const router = Router();

router.use(authenticate);
router.use(requireAdmin);

// Progress operartive election.
router.get('/:electionId', scrutinyController.operativeStatusElection);
router.get('/:electionId/results', scrutinyController.resultsScrutiny);

router.post('/:electionId/submit-key', scrutinyController.submitKey);
router.post('/:electionId/assign-members', scrutinyController.assingMembersElection);
router.post('/:electionId/finalize', scrutinyController.finalizedElection);

export default router;

