import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../../../middleware/authenticate';
import { requireAdmin } from '../../../middleware/requireAdmin';
import * as userController from '../controllers/userController';
import { validateBody, validateUuidParam } from '../../../middleware/validateRequest';
import {
  createStudentSchema, updateStudentSchema, createAdminSchema, updateAdminSchema,
} from '../schemas/userSchemas';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(authenticate);
router.use(requireAdmin);
router.param('id', validateUuidParam);

// Estudiantes
router.get('/students', userController.getStudents);
router.get('/students/catalog', userController.getStudentCatalog);
router.get('/students/:id', userController.getStudentById);
router.post('/students', validateBody(createStudentSchema), userController.createStudent);
router.put('/students/:id', validateBody(updateStudentSchema), userController.updateStudent);
router.delete('/students/:id', userController.deleteStudent);
router.post('/students/import', upload.single('file'), userController.importPadron);

// Admins
router.get('/admins', userController.getAdmins);
router.get('/admins/:id', userController.getAdminById);
router.post('/admins', validateBody(createAdminSchema), userController.createAdmin);
router.put('/admins/:id', validateBody(updateAdminSchema), userController.updateAdmin);
router.delete('/admins/:id', userController.deleteAdmin);

export default router;
