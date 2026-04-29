import { CorsOptions } from 'cors';
import { env } from './env';

// Configuración de CORS para permitir solicitudes desde el frontend
export const corsOptions: CorsOptions = {
  origin: env.corsOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};
