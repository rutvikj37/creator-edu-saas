import { http } from './client.js';

export const systemApi = {
  info: () => http.get('/system/info').then((r) => r.data),
  // Health returns 503 with the same shape when a dependency is down; surface both.
  health: () =>
    http.get('/health').then(
      (r) => r.data,
      (err) => {
        if (err.status === 503) return { status: 'error', unavailable: true };
        throw err;
      },
    ),
};
