import { AppError } from './appError';

export function badRequest(code: string, message: string, details?: unknown): AppError {
  return new AppError({ status: 400, code, message, details });
}

export function forbidden(code: string, message: string, details?: unknown): AppError {
  return new AppError({ status: 403, code, message, details });
}

export function notFound(code: string, message: string, details?: unknown): AppError {
  return new AppError({ status: 404, code, message, details });
}

export function conflict(code: string, message: string, details?: unknown): AppError {
  return new AppError({ status: 409, code, message, details });
}

export function internalError(code: string, message: string, details?: unknown, cause?: unknown): AppError {
  return new AppError({ status: 500, code, message, details, cause });
}
