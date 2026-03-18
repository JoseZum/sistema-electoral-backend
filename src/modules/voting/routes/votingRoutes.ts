import { Router } from 'express';
import { authenticate } from '../../../middleware/authenticate';
import * as votingController from '../controllers/votingController';

const router = Router();

// All voting routes require authentication
router.use(authenticate);

// List elections available to the current voter
router.get('/elections', votingController.getMyElections);

// Get election detail for voting
router.get('/elections/:id', votingController.getElectionDetail);

// Request vote token (anonymous elections only)
router.post('/elections/:id/token', votingController.requestToken);

// Cast vote
router.post('/cast', votingController.castVote);

// Get results
router.get('/elections/:id/results', votingController.getResults);

export default router;
