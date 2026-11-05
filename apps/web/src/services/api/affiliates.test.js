import { vi } from 'vitest';
import { affiliatesApi, captureReferral, storedReferral } from './affiliates.js';

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

it('remembers a valid referral for the program window and ignores invalid codes', async () => {
  const click = vi.spyOn(affiliatesApi, 'click');
  click.mockResolvedValueOnce({ valid: false });
  await captureReferral('?ref=NOPE12', '/');
  expect(storedReferral()).toBeNull();
  click.mockResolvedValueOnce({ valid: true, cookieDays: 30 });
  await captureReferral('?ref=pooja1a2b3c', '/courses/sql');
  expect(click).toHaveBeenLastCalledWith('pooja1a2b3c', '/courses/sql');
  expect(storedReferral()).toBe('POOJA1A2B3C');
  await captureReferral('?ref=<script>', '/');
  expect(click).toHaveBeenCalledTimes(2);
});

it('forgets an expired referral', () => {
  localStorage.setItem('ce.ref', JSON.stringify({ code: 'OLD', until: Date.now() - 1 }));
  expect(storedReferral()).toBeNull();
});
