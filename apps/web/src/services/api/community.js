import { http } from './client.js';

const d = (r) => r.data;

/** `base` is '/creator/communities' (staff) or '/learn/communities' (students). */
export const communityApi = (base) => ({
  spaces: () => http.get(base).then(d),
  posts: (id, cursor) => http.get(`${base}/${id}/posts`, { params: cursor ? { cursor } : {} }).then(d),
  createPost: (id, body) => http.post(`${base}/${id}/posts`, body).then(d),
  post: (postId) => http.get(`${base}/posts/${postId}`).then(d),
  comment: (postId, body) => http.post(`${base}/posts/${postId}/comments`, { body }).then(d),
  like: (postId) => http.post(`${base}/posts/${postId}/like`).then(d),
  deletePost: (postId) => http.delete(`${base}/posts/${postId}`).then(d),
  report: (body) => http.post(`${base}/reports`, body).then(d),
  // staff only
  create: (body) => http.post(base, body).then(d),
  update: (id, body) => http.patch(`${base}/${id}`, body).then(d),
  archive: (id) => http.post(`${base}/${id}/archive`).then(d),
  moderate: (postId, action) => http.post(`${base}/posts/${postId}/moderate`, { action }).then(d),
  hideComment: (commentId, hidden) => http.post(`${base}/comments/${commentId}/hide`, { hidden }).then(d),
  reports: () => http.get(`${base}/reports`).then(d),
  resolveReport: (id) => http.post(`${base}/reports/${id}/resolve`).then(d),
});

export const membershipsApi = {
  plans: () => http.get('/creator/memberships').then(d),
  create: (body) => http.post('/creator/memberships', body).then(d),
  update: (id, body) => http.patch(`/creator/memberships/${id}`, body).then(d),
  members: (id) => http.get(`/creator/memberships/${id}/members`).then(d),
  publicPlans: () => http.get('/public/memberships').then(d),
  mine: () => http.get('/learn/memberships').then(d),
};
