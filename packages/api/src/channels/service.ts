import { randomBytes, timingSafeEqual } from 'crypto';

const TOKEN_BYTES = 32;
const BEARER_PREFIX = /^Bearer\s+/i;

/** Random per-instance secret shared between the API server and its connectors. */
export function generateServiceToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * Constant-time check of an `Authorization: Bearer <token>` header against the
 * configured service token. False when either side is missing — never a
 * default-open comparison.
 */
export function isValidServiceToken(
  authorization: string | undefined,
  expected: string | undefined,
): boolean {
  if (!authorization || !expected) {
    return false;
  }
  const presented = authorization.replace(BEARER_PREFIX, '').trim();
  if (presented.length === 0) {
    return false;
  }
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
