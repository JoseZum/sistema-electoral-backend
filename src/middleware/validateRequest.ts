import { RequestHandler, RequestParamHandler } from 'express';
import { z } from 'zod';
import { uuidSchema } from '../validation/common';
import { ParseOptions, parseInput } from '../validation/parseInput';

/** Pass only parsed, declared fields to the controller. */
export function validateBody(schema: z.ZodType, options?: ParseOptions): RequestHandler {
  return (req, _res, next) => {
    try {
      req.body = parseInput(schema, req.body, 'body', options);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const validateUuidParam: RequestParamHandler = (_req, _res, next, value, name) => {
  try {
    parseInput(z.object({ [name]: uuidSchema }), { [name]: value }, 'params');
    next();
  } catch (error) {
    next(error);
  }
};
