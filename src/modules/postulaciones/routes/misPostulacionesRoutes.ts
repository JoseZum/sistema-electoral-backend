import { NextFunction, Request, Response, Router } from 'express';
import multer, { MulterError } from 'multer';
import { authenticate } from '../../../middleware/authenticate';
import { requireStudent } from '../../../middleware/resolveStudent';
import { badRequest } from '../../../errors/httpErrors';
import { ALLOWED_MIME_TYPES, MAX_FILE_BYTES } from '../constants/applicationFields';
import * as controller from '../controllers/misPostulacionesController';

const router = Router();

/**
 * Un archivo por peticion y con techo de tamano.
 *
 * En Vercel el cuerpo de una funcion serverless no puede pasar de 4.5 MB,
 * asi que los cinco adjuntos se suben de uno en uno.
 *
 * El `fileFilter` es solo un primer filtro barato: el mimetype lo declara el
 * cliente, asi que el service vuelve a validar contra los magic bytes.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if ((ALLOWED_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(null, false);
  },
});

/**
 * Traduce los errores de multer a errores de dominio.
 *
 * Sin esto, pasarse del limite de tamano llega al errorHandler como una
 * excepcion desconocida y el estudiante recibe un 500 en vez de saber que
 * su archivo pesa demasiado.
 */
function uploadSingleFile(req: Request, res: Response, next: NextFunction): void {
  upload.single('file')(req, res, (error: unknown) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        next(
          badRequest(
            'APPLICATION_FILE_TOO_LARGE',
            `El archivo no puede pasar de ${MAX_FILE_BYTES / (1024 * 1024)} MB`
          )
        );
        return;
      }
      if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') {
        next(badRequest('APPLICATION_FILE_SINGLE_ONLY', 'Sube un archivo a la vez'));
        return;
      }
      next(badRequest('APPLICATION_FILE_INVALID_UPLOAD', 'No se pudo procesar el archivo enviado'));
      return;
    }

    next(error);
  });
}

router.use(authenticate);
router.use(requireStudent);

router.get('/', controller.getMyForms);
router.get('/archivos/:fileId', controller.getMyFile);

router.get('/:formId', controller.getMyApplication);
router.put('/:formId', controller.saveMyApplication);
router.post('/:formId/enviar', controller.submitMyApplication);

router.post('/:formId/archivos/:fieldKey', uploadSingleFile, controller.uploadMyFile);
router.delete('/:formId/archivos/:fileId', controller.deleteMyFile);

export default router;
