import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { corsOptions } from './config/cors';
import { authRoutes } from './modules/auth';
import { userRoutes } from './modules/users';
import { errorHandler } from './middleware/errorHandler';

const app = express();

// Middleware de seguridad
app.use(helmet());
app.use(cors(corsOptions));

// Limitación de tasa de peticiones
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Demasiados intentos de autenticación, por favor intente más tarde' },
});
app.use('/api/auth', authLimiter);

// Parseo del cuerpo de las peticiones
app.use(express.json({ limit: '1mb' }));

// Rutas
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Manejo de errores
app.use(errorHandler);

export default app;
