import { http } from './client.js';

const d = (r) => r.data;
const page = (r) => ({ items: r.data, meta: r.meta });
const qs = (params = {}) =>
  Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));

export const platformApi = {
  dashboard: (params) => http.get('/platform/dashboard', { params: qs(params) }).then(d),
  tenants: (params) => http.get('/platform/tenants', { params: qs(params) }).then(page),
  tenant: (id) => http.get(`/platform/tenants/${id}`).then(d),
  activateTenant: (id) => http.post(`/platform/tenants/${id}/activate`).then(d),
  suspendTenant: (id, reason) => http.post(`/platform/tenants/${id}/suspend`, { reason }).then(d),
  assignPlan: (id, body) => http.post(`/platform/tenants/${id}/subscription`, body).then(d),
  setLimits: (id, overrides) => http.put(`/platform/tenants/${id}/limits`, { overrides }).then(d),
  deleteTenant: (id, confirmSlug) => http.delete(`/platform/tenants/${id}`, { data: { confirmSlug } }).then(d),
  restoreTenant: (id) => http.post(`/platform/tenants/${id}/restore`).then(d),
  features: () => http.get('/platform/features').then(d),
  plans: () => http.get('/platform/plans').then(d),
  plan: (id) => http.get(`/platform/plans/${id}`).then(d),
  createPlan: (body) => http.post('/platform/plans', body).then(d),
  updatePlan: (id, body) => http.put(`/platform/plans/${id}`, body).then(d),
  settings: () => http.get('/platform/settings').then(d),
  updateSettings: (items) => http.put('/platform/settings', { items }).then(d),
  admins: () => http.get('/platform/admins').then(d),
  inviteAdmin: (body) => http.post('/platform/admins', body).then(d),
  setAdminRoles: (id, roles) => http.put(`/platform/admins/${id}/roles`, { roles }).then(d),
  suspendAdmin: (id) => http.post(`/platform/admins/${id}/suspend`).then(d),
  reactivateAdmin: (id) => http.post(`/platform/admins/${id}/reactivate`).then(d),
  auditLogs: (params) => http.get('/platform/audit-logs', { params: qs(params) }).then(page),
  categories: () => http.get('/public/categories').then(d),
  createCategory: (body) => http.post('/platform/categories', body).then(d),
  updateCategory: (id, body) => http.put(`/platform/categories/${id}`, body).then(d),
  deleteCategory: (id) => http.delete(`/platform/categories/${id}`).then(d),
  announcements: () => http.get('/platform/announcements').then(d),
  createAnnouncement: (body) => http.post('/platform/announcements', body).then(d),
  updateAnnouncement: (id, body) => http.put(`/platform/announcements/${id}`, body).then(d),
  deleteAnnouncement: (id) => http.delete(`/platform/announcements/${id}`).then(d),
  tickets: (params) => http.get('/platform/support/tickets', { params: qs(params) }).then(page),
  ticket: (id) => http.get(`/platform/support/tickets/${id}`).then(d),
  replyTicket: (id, body) => http.post(`/platform/support/tickets/${id}/messages`, body).then(d),
  updateTicket: (id, body) => http.patch(`/platform/support/tickets/${id}`, body).then(d),
  supportAgents: () => http.get('/platform/support/agents').then(d),
  supportReport: () => http.get('/platform/support/report').then(d),
};

export const creatorApi = {
  billing: () => http.get('/creator/billing').then(d),
  publicPlans: () => http.get('/public/plans').then(d),
  tickets: (params) => http.get('/creator/support/tickets', { params: qs(params) }).then(page),
  ticket: (id) => http.get(`/creator/support/tickets/${id}`).then(d),
  createTicket: (body) => http.post('/creator/support/tickets', body).then(d),
  replyTicket: (id, body) => http.post(`/creator/support/tickets/${id}/messages`, { body }).then(d),
};

export const commonApi = {
  activeAnnouncements: () => http.get('/announcements/active').then(d),
};
