/**
 * Este modulo centraliza el manejo de errores de aplicacion.
 *
 * Que define:
 * - AppErrorOptions: contrato para construir errores con metadatos.
 * - AppError: error tipado con status HTTP, codigo interno y detalles opcionales.
 * - isAppError: type guard para validar si un error es AppError.
 *
 * Como funciona:
 * 1) Se crea una instancia de AppError con status, code y message.
 * 2) Opcionalmente se adjuntan details y cause para depuracion.
 * 3) En capas superiores (middleware/controladores), isAppError permite
 *    distinguir errores esperados de errores no controlados.
 */

export interface AppErrorOptions {
  status: number;
  code: string;
  message: string;
  details?: unknown;
  /**
   * Datos que el cliente necesita para resolver el error y que son seguros de
   * publicar. A diferencia de `details` (interno, solo visible en desarrollo),
   * `meta` viaja siempre en la respuesta, asi que quien lo usa se hace
   * responsable de no meter ahi nada sensible.
   *
   * Ejemplo: el resumen de bajas que acompaña a PADRON_IMPORT_NEEDS_CONFIRMATION,
   * sin el cual la UI no puede explicar que se va a desactivar.
   */
  meta?: Record<string, unknown>;
  cause?: unknown;
}

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly meta?: Record<string, unknown>;

  constructor({ status, code, message, details, meta, cause }: AppErrorOptions) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.meta = meta;

    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }

    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
