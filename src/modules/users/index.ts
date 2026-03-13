export { findStudentByEmail, findStudentByCarnet, findStudentById } from './repositories/studentRepository';
export { findAdminByStudentId } from './repositories/adminRepository';
export type { Student, Admin } from './models/userModel';
export { default as userRoutes } from './routes/userRoutes';
