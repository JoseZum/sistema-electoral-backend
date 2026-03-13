import { Router } from 'express';
import multer from 'multer';
import * as userController from '../controllers/userController';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// ── Estudiantes ──
router.get('/students', userController.getStudents);
router.get('/students/:id', userController.getStudentById);
router.post('/students', userController.createStudent);
router.put('/students/:id', userController.updateStudent);
router.delete('/students/:id', userController.deleteStudent);
router.post('/students/import', upload.single('file'), userController.importPadron);

// ── Admins ──
router.get('/admins', userController.getAdmins);
router.get('/admins/:id', userController.getAdminById);
router.post('/admins', userController.createAdmin);
router.put('/admins/:id', userController.updateAdmin);
router.delete('/admins/:id', userController.deleteAdmin);

export default router;
