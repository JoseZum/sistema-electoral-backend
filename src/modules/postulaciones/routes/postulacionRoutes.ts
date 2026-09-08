import { Router } from 'express';
import { authenticate } from '../../../middleware/authenticate';
import { requireAdmin } from '../../../middleware/requireAdmin';
import * as controller from '../controllers/postulacionController';
import { validateBody, validateUuidParam } from '../../../middleware/validateRequest';
import {
  createApplicationFormSchema, updateApplicationFormSchema, positionSchema, reviewApplicationSchema,
  applicationFormErrors, positionErrors, reviewApplicationErrors,
} from '../schemas/postulacionSchemas';

const router = Router();

router.use(authenticate);
router.use(requireAdmin);
router.param('id', validateUuidParam);
router.param('positionId', validateUuidParam);
router.param('fileId', validateUuidParam);

// Formularios
router.get('/formularios', controller.getForms);
router.post('/formularios', validateBody(createApplicationFormSchema, applicationFormErrors), controller.createForm);
router.get('/formularios/:id', controller.getFormById);
router.put('/formularios/:id', validateBody(updateApplicationFormSchema, applicationFormErrors), controller.updateForm);
router.delete('/formularios/:id', controller.deleteForm);

// Puestos: editables en cualquier momento, incluso con el formulario abierto
router.get('/formularios/:id/puestos', controller.getPositions);
router.post('/formularios/:id/puestos', validateBody(positionSchema, positionErrors), controller.createPosition);
router.put('/puestos/:positionId', validateBody(positionSchema, positionErrors), controller.updatePosition);
router.delete('/puestos/:positionId', controller.deletePosition);

// Respuestas
router.get('/formularios/:id/respuestas', controller.getApplications);
router.get('/respuestas/:id', controller.getApplicationById);
router.post('/respuestas/:id/revision', validateBody(reviewApplicationSchema, reviewApplicationErrors), controller.reviewApplication);

// Adjuntos
router.get('/archivos/:fileId', controller.getFile);

export default router;
