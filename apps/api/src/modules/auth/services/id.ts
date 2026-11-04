import { randomBytes } from 'node:crypto';

/** 25-char lowercase id compatible with CHAR(25) columns (time-prefixed for rough ordering). */
export function createId(): string {
  const time = Date.now().toString(36).padStart(9, '0');
  const rand = randomBytes(12).toString('base64url').replace(/[^a-z0-9]/gi, '').toLowerCase().padEnd(16, '0').slice(0, 16);
  return `c${time}${rand}`.slice(0, 25);
}
