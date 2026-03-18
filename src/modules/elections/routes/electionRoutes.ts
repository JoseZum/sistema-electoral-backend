import { Router } from 'express';
import { authenticate } from '../../../middleware/authenticate';
import { requireAdmin } from '../../../middleware/requireAdmin';
import * as electionController from '../controllers/electionController';

const router = Router();

// All election management routes require authentication
router.use(authenticate);
router.use(requireAdmin);

// Elections CRUD
router.get('/', electionController.getElections);
router.post('/', electionController.createElection);
router.get('/:id', electionController.getElectionById);
router.put('/:id', electionController.updateElection);
router.delete('/:id', electionController.deleteElection);

// Status management
router.put('/:id/status', electionController.changeStatus);

// Options
router.post('/:id/options', electionController.addOption);
router.put('/:id/options/:optionId', electionController.updateOption);
router.delete('/:id/options/:optionId', electionController.deleteOption);

// Voters
router.post('/:id/voters/populate', electionController.populateVoters);
router.delete('/:id/voters', electionController.clearVoters);

// Results
router.get('/:id/results', electionController.getResults);

export default router;
