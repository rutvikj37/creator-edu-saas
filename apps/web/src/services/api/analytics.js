import { http } from './client.js';

const d = (r) => r.data;
const clean = (p) => Object.fromEntries(Object.entries(p ?? {}).filter(([, v]) => v));

export const analyticsApi = {
  overview: (range) => http.get('/creator/analytics/overview', { params: clean(range) }).then(d),
  reports: (days) => http.get('/creator/analytics/reports', { params: { days } }).then(d),
  exportsList: (page) => http.get('/creator/analytics/exports', { params: { page } }).then(d),
  exportDownload: (id) => http.get(`/creator/analytics/exports/${id}/download`, { responseType: 'blob' }).then(d),
  courses: () => http.get('/creator/analytics/courses').then(d),
  conversions: (range) => http.get('/creator/analytics/conversions', { params: clean(range) }).then(d),
  gst: (range) => http.get('/creator/analytics/gst', { params: clean(range) }).then(d),
  /** kind: gst | orders | students | enrollments */
  exportCsv: (kind, params) => http.get(`/creator/analytics/exports/${kind}.csv`, { params: clean(params), responseType: 'blob' }).then((r) => r.data),
};
