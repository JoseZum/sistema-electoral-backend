import { Router } from 'express';
import { authenticate } from '../../../middleware/authenticate';
import { requireAdmin } from '../../../middleware/requireAdmin';
import * as controller from '../controllers/postulacionController';

const router = Router();

router.use(authenticate);
router.use(requireAdmin);

// Formularios
router.get('/formularios', controller.getForms);
router.post('/formularios', controller.createForm);
router.get('/formularios/:id', controller.getFormById);
router.put('/formularios/:id', controller.updateForm);
router.delete('/formularios/:id', controller.deleteForm);

// Puestos: editables en cualquier momento, incluso con el formulario abierto
router.get('/formularios/:id/puestos', controller.getPositions);
router.post('/formularios/:id/puestos', controller.createPosition);
router.put('/puestos/:positionId', controller.updatePosition);
router.delete('/puestos/:positionId', controller.deletePosition);

// Respuestas
router.get('/formularios/:id/respuestas', controller.getApplications);
router.get('/respuestas/:id', controller.getApplicationById);
router.post('/respuestas/:id/revision', controller.reviewApplication);

// Adjuntos
router.get('/archivos/:fileId', controller.getFile);

export default router;
