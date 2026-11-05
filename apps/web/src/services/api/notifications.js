import { http } from './client.js';

const d = (r) => r.data;

export const notificationsApi = {
  list: (cursor) => http.get('/notifications', { params: cursor ? { cursor } : {} }).then(d),
  read: (id) => http.post(`/notifications/${id}/read`).then(d),
  readAll: () => http.post('/notifications/read-all').then(d),
  preferences: () => http.get('/notifications/preferences').then(d),
  setPreferences: (items) => http.put('/notifications/preferences', { items }).then(d),
  subscribePush: (sub) => http.post('/notifications/push/subscriptions', sub).then(d),
  unsubscribePush: (endpoint) => http.delete('/notifications/push/subscriptions', { data: { endpoint } }).then(d),
};
