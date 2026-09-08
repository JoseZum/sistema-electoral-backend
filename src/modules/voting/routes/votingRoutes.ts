import { Router } from 'express';
import { authenticate } from '../../../middleware/authenticate';
import * as votingController from '../controllers/votingController';
import { validateBody, validateUuidParam } from '../../../middleware/validateRequest';
import { castVoteSchema } from '../schemas/votingSchemas';

const router = Router();

// All voting routes require authentication
router.use(authenticate);
router.param('id', validateUuidParam);

// List elections available to the current voter
router.get('/elections', votingController.getMyElections);

// Get election detail for voting
router.get('/elections/:id', votingController.getElectionDetail);

// Cast vote
router.post('/cast', validateBody(castVoteSchema), votingController.castVote);

// Get results
router.get('/elections/:id/results', votingController.getResults);

export default router;
