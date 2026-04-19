import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { corsOptions } from './config/cors';
import { authRoutes } from './modules/auth';
import { userRoutes } from './modules/users';
import { electionRoutes } from './modules/elections';
import { tagRoutes } from './modules/tags';
import { votingRoutes } from './modules/voting';
import { auditRoutes } from './modules/audit';
import { scrutinyRoutes } from './modules/scrutiny';
import { errorHandler } from './middleware/errorHandler';
import { dashboardRoutes } from './modules/dashboard';

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
app.use('/api/elections', electionRoutes);
app.use('/api/tags', tagRoutes);
app.use('/api/voting', votingRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/scrutiny', scrutinyRoutes);
app.use('/api/dashboard', dashboardRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Manejo de errores
app.use(errorHandler);

export default app;
