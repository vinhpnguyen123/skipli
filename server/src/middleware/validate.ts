import type { RequestHandler } from 'express';
import type { ZodTypeAny } from 'zod';
import { AppError } from '../lib/errors.js';

type Schemas = { body?: ZodTypeAny; params?: ZodTypeAny; query?: ZodTypeAny };

// Usage: validate({ body: createEmployeeSchema, params: idParams }). Each schema should be .strict().
// Every part is checked before failing, so the client gets all errors at once.
export const validate =
  (schemas: Schemas): RequestHandler =>
  (req, _res, next) => {
    const details: { in: string; path: string; message: string }[] = [];
    const parsed: Partial<Record<keyof Schemas, unknown>> = {};
    for (const part of ['params', 'query', 'body'] as const) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part]);
      if (result.success) parsed[part] = result.data;
      else
        for (const i of result.error.issues)
          details.push({ in: part, path: i.path.join('.'), message: i.message });
    }
    if (details.length) throw new AppError('VALIDATION_ERROR', 'Invalid request', 400, details);

    if ('body' in parsed) req.body = parsed.body;
    if ('params' in parsed) req.params = parsed.params as typeof req.params;
    // Express 5 exposes req.query as a getter, so shadow it on the instance to hand over the parsed value.
    if ('query' in parsed)
      Object.defineProperty(req, 'query', {
        value: parsed.query,
        writable: true,
        enumerable: true,
      });
    next();
  };
