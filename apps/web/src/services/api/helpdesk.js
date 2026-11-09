import { http } from './client.js';

const d = (r) => r.data;
const page = (r) => ({ items: r.data, meta: r.meta });
const qs = (params = {}) => Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));

export const learnSupportApi = {
  tickets: (params) => http.get('/learn/support/tickets', { params: qs(params) }).then(page),
  ticket: (id) => http.get(`/learn/support/tickets/${id}`).then(d),
  create: (body) => http.post('/learn/support/tickets', body).then(d),
  reply: (id, body) => http.post(`/learn/support/tickets/${id}/messages`, { body }).then(d),
  close: (id) => http.post(`/learn/support/tickets/${id}/close`).then(d),
};

export const helpdeskApi = {
  tickets: (params) => http.get('/creator/helpdesk/tickets', { params: qs(params) }).then(page),
  summary: () => http.get('/creator/helpdesk/summary').then(d),
  team: () => http.get('/creator/helpdesk/team').then(d),
  ticket: (id) => http.get(`/creator/helpdesk/tickets/${id}`).then(d),
  reply: (id, body) => http.post(`/creator/helpdesk/tickets/${id}/messages`, body).then(d),
  update: (id, patch) => http.patch(`/creator/helpdesk/tickets/${id}`, patch).then(d),
};
