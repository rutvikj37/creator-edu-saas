import { http } from './client.js';

const d = (r) => r.data;
const clean = (p) => Object.fromEntries(Object.entries(p ?? {}).filter(([, v]) => v));

export const analyticsApi = {
  overview: (range) => http.get('/creator/analytics/overview', { params: clean(range) }).then(d),
  courses: () => http.get('/creator/analytics/courses').then(d),
  gst: (range) => http.get('/creator/analytics/gst', { params: clean(range) }).then(d),
  /** kind: gst | orders | students | enrollments */
  exportCsv: (kind, params) => http.get(`/creator/analytics/exports/${kind}.csv`, { params: clean(params), responseType: 'blob' }).then((r) => r.data),
};
