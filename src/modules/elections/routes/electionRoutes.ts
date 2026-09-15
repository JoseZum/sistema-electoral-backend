import { Router } from 'express';
import { authenticate } from '../../../middleware/authenticate';
import { requireAdmin } from '../../../middleware/requireAdmin';
import * as electionController from '../controllers/electionController';
import { validateBody, validateUuidParam } from '../../../middleware/validateRequest';
import {
  createElectionRequestSchema, updateElectionSchema, changeElectionStatusSchema,
  createOptionSchema, updateOptionSchema, populateVotersSchema, createSuboptionPresetSchema,
} from '../schemas/electionSchemas';

const router = Router();

// All election management routes require authentication
router.use(authenticate);
router.use(requireAdmin);
router.param('id', validateUuidParam);
router.param('optionId', validateUuidParam);

// Elections CRUD
router.get('/', electionController.getElections);
router.post('/', validateBody(createElectionRequestSchema), electionController.createElection);
router.get('/suboption-presets', electionController.getSuboptionPresets);
router.post('/suboption-presets', validateBody(createSuboptionPresetSchema), electionController.createSuboptionPreset);
router.get('/:id', electionController.getElectionById);
router.put('/:id', validateBody(updateElectionSchema), electionController.updateElection);
router.delete('/:id', electionController.deleteElection);

// Status management
router.put('/:id/status', validateBody(changeElectionStatusSchema), electionController.changeStatus);

// Options
router.post('/:id/options', validateBody(createOptionSchema), electionController.addOption);
router.put('/:id/options/:optionId', validateBody(updateOptionSchema), electionController.updateOption);
router.delete('/:id/options/:optionId', electionController.deleteOption);

// Voters
router.post('/:id/voters/populate', validateBody(populateVotersSchema), electionController.populateVoters);
router.delete('/:id/voters', electionController.clearVoters);

// Results
router.get('/:id/results', electionController.getResults);

// Monitoring
router.get('/:id/monitoring', electionController.getMonitoringData);
router.get('/:id/voters-by-sede', electionController.getVotersBySede);

export default router;
