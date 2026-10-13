import type { RequestHandler } from 'express';
import type { ZodTypeAny } from 'zod';
import { AppError } from '../lib/errors.js';

// ponytail: body only. Route params are ids the service looks up anyway; add params/query when a route needs them
// (Express 5's req.query is read-only, so a parsed query would go on res.locals).
export const validate =
  (schema: ZodTypeAny): RequestHandler =>
  (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      throw new AppError('VALIDATION_ERROR', 'Invalid request body', 400, details);
    }
    req.body = result.data;
    next();
  };
