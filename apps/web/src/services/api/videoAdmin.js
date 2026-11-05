import { http } from './client.js';

const d = (r) => r.data;
const page = (r) => ({ items: r.data, meta: r.meta });

export const videoAdminApi = {
  usage: (period) => http.get('/platform/videos/usage', { params: period ? { period } : {} }).then(d),
  backups: (params) => http.get('/backups', { params }).then(page),
  backup: (id) => http.get(`/backups/${id}`).then(d),
  retry: (id) => http.post(`/backups/${id}/retry`).then(d),
  restore: (id) => http.post(`/backups/${id}/restore`).then(d),
  quota: () => http.get('/backups/drive/quota').then(d),
  connect: () => http.post('/backups/drive/oauth/start').then(d),
  disconnect: () => http.post('/backups/drive/disconnect').then(d),
  backupCourseDocuments: (courseId) => http.post('/backups/documents', { courseId }).then(d),
};
