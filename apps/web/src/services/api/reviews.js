import { http } from './client.js';

const d = (r) => r.data;

export const reviewsApi = {
  mine: (courseId) => http.get(`/learn/courses/${courseId}/review`).then(d),
  save: (courseId, body) => http.put(`/learn/courses/${courseId}/review`, body).then(d),
  remove: (courseId) => http.delete(`/learn/courses/${courseId}/review`).then(d),
  publicList: (slug, params) => http.get(`/public/courses/${encodeURIComponent(slug)}/reviews`, { params }).then(d),
  list: (params) => http.get('/creator/reviews', { params }).then(d),
  reply: (id, reply) => http.post(`/creator/reviews/${id}/reply`, { reply }).then(d),
  setStatus: (id, status, reason) => http.post(`/creator/reviews/${id}/status`, { status, reason }).then(d),
};
