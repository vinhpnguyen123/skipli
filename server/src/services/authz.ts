import type { TokenClaims } from '../middleware/auth.js';
import { AppError } from '../lib/errors.js';

// Ownership check (IDOR guard). Call it after loading the resource: the owner sees everything,
// an employee only resources whose ownerId is their own id. 404 rather than 403 so ids of other
// people's resources don't leak. Callers handle "resource doesn't exist" themselves before this.
export function assertCanAccess(user: TokenClaims, ownerId: string): void {
  if (user.role === 'owner' || user.id === ownerId) return;
  throw new AppError('NOT_FOUND', 'Not found', 404);
}
