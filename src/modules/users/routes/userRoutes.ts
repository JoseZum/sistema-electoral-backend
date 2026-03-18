import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../../../middleware/authenticate';
import * as userController from '../controllers/userController';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// ── Estudiantes ──
router.get('/students', userController.getStudents);
router.get('/students/catalog', userController.getStudentCatalog);
router.get('/students/:id', userController.getStudentById);
router.post('/students', authenticate, userController.createStudent);
router.put('/students/:id', authenticate, userController.updateStudent);
router.delete('/students/:id', authenticate, userController.deleteStudent);
router.post('/students/import', authenticate, upload.single('file'), userController.importPadron);

// ── Admins ──
router.get('/admins', userController.getAdmins);
router.get('/admins/:id', userController.getAdminById);
router.post('/admins', authenticate, userController.createAdmin);
router.put('/admins/:id', authenticate, userController.updateAdmin);
router.delete('/admins/:id', authenticate, userController.deleteAdmin);

export default router;
