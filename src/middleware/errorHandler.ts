/**
 * Middleware global de manejo de errores para Express.
 *
 * Que hace este modulo:
 * - Detecta errores conocidos (JWT, JSON invalido y conexion/auth de BD).
 * - Normaliza cualquier error al formato AppError.
 * - Registra en consola contexto util para diagnostico.
 * - Devuelve una respuesta HTTP consistente con code y mensaje.
 *
 * Flujo general:
 * 1) normalizeError transforma el error crudo en AppError.
 * 2) errorHandler escribe un log estructurado del incidente.
 * 3) Se responde al cliente con status/code estandarizados.
 * 4) En desarrollo, incluye details cuando existe informacion adicional.
 * 
*/

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AppError, isAppError } from '../errors/appError';

type DatabaseError = Error & {
  code?: string;
  detail?: string;
  constraint?: string;
  table?: string;
  column?: string;
};

function isDatabaseError(error: unknown): error is DatabaseError {
  return error instanceof Error && typeof (error as { code?: unknown }).code === 'string';
}

function getDatabaseErrorDetails(error: DatabaseError) {
  return {
    message: error.message,
    detail: error.detail,
    constraint: error.constraint,
    table: error.table,
    column: error.column,
  };
}

function normalizeError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }

  if (error instanceof jwt.TokenExpiredError) {
    return new AppError({
      status: 401,
      code: 'AUTH_TOKEN_EXPIRED',
      message: 'La sesion con Microsoft expiro. Inicia sesion nuevamente.',
      details: error.message,
      cause: error,
    });
  }

  if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.NotBeforeError) {
    return new AppError({
      status: 401,
      code: 'AUTH_TOKEN_INVALID',
      message: 'Autenticacion fallida: token invalido.',
      details: error.message,
      cause: error,
    });
  }

  if (error instanceof SyntaxError && 'body' in (error as object)) {
    return new AppError({
      status: 400,
      code: 'INVALID_JSON_BODY',
      message: 'El cuerpo de la peticion no es JSON valido.',
      details: error.message,
      cause: error,
    });
  }

  if (isDatabaseError(error)) {
    const code = error.code || '';

    if (code === '28P01' || error.message.includes('password authentication failed')) {
      return new AppError({
        status: 503,
        code: 'DB_AUTH_FAILED',
        message: 'El servicio no esta disponible en este momento.',
        details: error.message,
        cause: error,
      });
    }

    if (code.startsWith('08') || error.message.includes('ECONNREFUSED')) {
      return new AppError({
        status: 503,
        code: 'DB_CONNECTION_ERROR',
        message: 'No fue posible conectar con la base de datos.',
        details: error.message,
        cause: error,
      });
    }

    if (code === '23505') {
      return new AppError({
        status: 409,
        code: 'DB_UNIQUE_VIOLATION',
        message: 'El registro ya existe o viola una restriccion unica.',
        details: getDatabaseErrorDetails(error),
        cause: error,
      });
    }

    if (code === '23503') {
      return new AppError({
        status: 400,
        code: 'DB_FOREIGN_KEY_VIOLATION',
        message: 'La referencia enviada no existe o no es valida.',
        details: getDatabaseErrorDetails(error),
        cause: error,
      });
    }

    if (code === '23502') {
      return new AppError({
        status: 400,
        code: 'DB_REQUIRED_FIELD_MISSING',
        message: 'Falta un campo obligatorio para completar la operacion.',
        details: getDatabaseErrorDetails(error),
        cause: error,
      });
    }

    if (code === '23514') {
      return new AppError({
        status: 400,
        code: 'DB_CHECK_VIOLATION',
        message: 'Los datos enviados no cumplen una restriccion de validacion.',
        details: getDatabaseErrorDetails(error),
        cause: error,
      });
    }

    if (code === '22P02') {
      return new AppError({
        status: 400,
        code: 'DB_INVALID_INPUT',
        message: 'Uno de los identificadores o valores enviados no tiene un formato valido.',
        details: getDatabaseErrorDetails(error),
        cause: error,
      });
    }
  }

  return new AppError({
    status: 500,
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Error interno del servidor',
    details: error instanceof Error ? error.message : String(error),
    cause: error,
  });
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const normalized = normalizeError(err);

  console.error(`[${normalized.code}] ${req.method} ${req.originalUrl}`, {
    message: normalized.message,
    details: normalized.details,
    stack: err instanceof Error ? err.stack : undefined,
  });

  res.status(normalized.status).json({
    error: normalized.message,
    code: normalized.code,
    ...(process.env.NODE_ENV === 'development' && normalized.details ? { details: normalized.details } : {}),
  });
}
