import { describe, expect, it } from 'vitest';
import { isValidTimeZone } from './timezone.js';

describe('isValidTimeZone', () => {
  it('accepts canonical names and aliases, rejects junk', () => {
    for (const tz of ['Asia/Kolkata', 'Asia/Calcutta', 'UTC', 'America/New_York', 'Europe/London']) expect(isValidTimeZone(tz)).toBe(true);
    for (const tz of ['', 'Mars/Olympus', 'Asia/Kolkata; DROP']) expect(isValidTimeZone(tz)).toBe(false);
  });
});
