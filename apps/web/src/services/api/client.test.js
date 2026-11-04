import { vi } from 'vitest';
import { http, setAccessTokenGetter, setRefreshHandler } from './client.js';

describe('http client token refresh', () => {
  afterEach(() => {
    http.defaults.adapter = undefined;
    setRefreshHandler(null);
    setAccessTokenGetter(() => null);
  });

  it('refreshes once on 401 and replays the request with the new token', async () => {
    let token = 'old';
    setAccessTokenGetter(() => token);
    const refresh = vi.fn(async () => {
      token = 'new';
      return 'new';
    });
    setRefreshHandler(refresh);
    const seen = [];
    http.defaults.adapter = async (config) => {
      seen.push(config.headers.Authorization);
      if (config.headers.Authorization === 'Bearer old') {
        const err = new Error('401');
        err.config = config;
        err.response = { status: 401, data: { success: false, error: { code: 'INVALID_TOKEN', message: 'expired' } }, config };
        throw err;
      }
      return { status: 200, statusText: 'OK', headers: {}, config, data: { success: true, data: { ok: 1 } } };
    };
    const res = await http.get('/auth/me');
    expect(res.data).toEqual({ ok: 1 });
    expect(refresh).toHaveBeenCalledOnce();
    expect(seen).toEqual(['Bearer old', 'Bearer new']);
  });

  it('does not loop when refresh fails', async () => {
    setAccessTokenGetter(() => 'old');
    setRefreshHandler(vi.fn(async () => { throw new Error('no session'); }));
    http.defaults.adapter = async (config) => {
      const err = new Error('401');
      err.config = config;
      err.response = { status: 401, data: { success: false, error: { code: 'INVALID_TOKEN', message: 'expired' } }, config };
      throw err;
    };
    await expect(http.get('/auth/me')).rejects.toMatchObject({ status: 401, code: 'INVALID_TOKEN' });
  });
});
