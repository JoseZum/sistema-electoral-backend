// IMPORTANTE: debe ser el primer import para que OpenTelemetry pueda auto-instrumentar
// express y pg antes de que se carguen. Es un no-op si la observabilidad esta apagada.
import './observability/telemetry';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { corsOptions } from './config/cors';
import { pool } from './config/database';
import { metricsMiddleware } from './middleware/metricsMiddleware';
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

// RateLimit general para todos los endpoints de la API
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones, por favor intente más tarde' },
});
app.use('/api', generalLimiter);

// RateLimit para seguridad en endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Demasiados intentos de autenticación, por favor intente más tarde' },
});
app.use('/api/auth', authLimiter);

// Parseo del cuerpo de las peticiones
app.use(express.json({ limit: '15mb' }));

// Metricas HTTP (latencia, throughput, tasa de error) por ruta. No-op si observabilidad apagada.
app.use('/api', metricsMiddleware);

// Rutas de los módulos
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

// Readiness: verifica conectividad real con la base de datos (util para monitoreo/alertas
// el dia de la votacion). No expone informacion sensible.
app.get('/api/health/db', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'up', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'error', db: 'down', timestamp: new Date().toISOString() });
  }
});

// Manejo de errores
app.use(errorHandler);

export default app;
