import { z } from 'zod';
import { AppError } from '../errors/appError';

type InputSource = 'body' | 'params' | 'query';
export type ErrorOptions = { code: string; message: string };

/**
 * Errores propios por campo. El valor puede ser un unico error para cualquier
 * fallo del campo, o uno por `code` de issue de Zod ('too_big', 'too_small',
 * 'invalid_type'...), donde '*' cubre los demas.
 */
export type FieldErrors = Record<string, ErrorOptions | Record<string, ErrorOptions>>;
export type ParseOptions = ErrorOptions | { fields: FieldErrors };

function isErrorOptions(rule: ErrorOptions | Record<string, ErrorOptions>): rule is ErrorOptions {
  return typeof rule.code === 'string' && typeof rule.message === 'string';
}

// Conserva los codigos que antes lanzaban los servicios: el cliente muestra el
// mensaje al usuario, asi que un 'VALIDATION_ERROR' generico seria un retroceso.
function resolveFieldError(error: z.ZodError, fields: FieldErrors): ErrorOptions | undefined {
  for (const issue of error.issues) {
    const rule = fields[String(issue.path[0])];
    if (!rule) continue;
    if (isErrorOptions(rule)) return rule;
    const match = rule[issue.code] ?? rule['*'];
    if (match) return match;
  }
  return undefined;
}

export class RequestValidationError extends AppError {
  readonly fields?: Array<{ path: string; message: string }>;

  constructor(error: z.ZodError, source: InputSource, custom?: ErrorOptions) {
    super({
      status: 400,
      code: custom?.code ?? 'VALIDATION_ERROR',
      message: custom?.message ?? 'Revisa los campos de la petición.',
    });
    this.name = 'RequestValidationError';
    // Con un mensaje propio la respuesta es opaca a proposito y no se detalla
    // que regla fallo; sin el se listan los campos para que el cliente corrija.
    // En ningun caso se incluyen los valores recibidos: las peticiones traen
    // tokens y llaves de escrutinio.
    if (!custom) {
      this.fields = error.issues.map((issue) => ({
        path: [source, ...issue.path].join('.'),
        message: issue.message,
      }));
    }
  }
}

const errorMap = z.locales.es().localeError;

export function parseInput<S extends z.ZodType>(
  schema: S,
  value: unknown,
  source: InputSource,
  options?: ParseOptions,
): z.output<S> {
  const result = schema.safeParse(value, { error: errorMap });
  if (result.success) {
    return result.data;
  }
  const custom = options && 'fields' in options
    ? resolveFieldError(result.error, options.fields)
    : options;
  throw new RequestValidationError(result.error, source, custom);
}
