import { vi } from 'vitest';
import { attribution, captureAttribution, track, visitorId } from './tracker.js';
import { http } from '../services/api/client.js';

vi.mock('../services/api/client.js', () => ({ http: { post: vi.fn(async () => ({})) } }));
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });

it('keeps one visitor id and the first-touch source for 30 days', () => {
  const id = visitorId();
  expect(id).toMatch(/^v-[\w-]{8,}$/);
  expect(visitorId()).toBe(id);
  captureAttribution('?utm_source=instagram&utm_medium=social&utm_campaign=diwali', '/courses/x', 'https://l.instagram.com/');
  captureAttribution('?utm_source=google', '/', ''); // later visits keep the first touch
  expect(attribution()).toEqual({ visitorId: id, source: 'instagram', medium: 'social', campaign: 'diwali', referrerHost: 'l.instagram.com', landingPath: '/courses/x' });
});

it('sends page views with attribution and respects Do Not Track', () => {
  captureAttribution('?utm_source=newsletter', '/', '');
  track('page_view', '/courses/x');
  expect(http.post).toHaveBeenCalledWith('/public/track', expect.objectContaining({ type: 'page_view', path: '/courses/x', source: 'newsletter', visitorId: expect.stringMatching(/^v-/) }));
  vi.stubGlobal('navigator', { ...navigator, doNotTrack: '1' });
  track('page_view', '/');
  expect(http.post).toHaveBeenCalledTimes(1);
  vi.unstubAllGlobals();
});
