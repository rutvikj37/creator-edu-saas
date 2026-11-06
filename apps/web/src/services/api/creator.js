import { http } from './client.js';

const d = (r) => r.data;
const page = (r) => ({ items: r.data, meta: r.meta });

export const academyApi2 = {
  get: () => http.get('/creator/academy').then(d),
  update: (body) => http.put('/creator/academy', body).then(d),
  business: () => http.get('/creator/academy/business').then(d),
  updateBusiness: (body) => http.put('/creator/academy/business', body).then(d),
  onboarding: () => http.get('/creator/onboarding').then(d),
  saveStep: (step) => http.put('/creator/onboarding/step', { step }).then(d),
  publish: () => http.post('/creator/onboarding/publish').then(d),
  dashboard: () => http.get('/creator/dashboard').then(d),
};

export const coursesApi = {
  list: (params) => http.get('/creator/courses', { params }).then(page),
  create: (body) => http.post('/creator/courses', body).then(d),
  get: (id) => http.get(`/creator/courses/${id}`).then(d),
  update: (id, body) => http.patch(`/creator/courses/${id}`, body).then(d),
  remove: (id) => http.delete(`/creator/courses/${id}`).then(d),
  publishCheck: (id) => http.get(`/creator/courses/${id}/publish-check`).then(d),
  publish: (id, body = {}) => http.post(`/creator/courses/${id}/publish`, body).then(d),
  unpublish: (id) => http.post(`/creator/courses/${id}/unpublish`).then(d),
  archive: (id) => http.post(`/creator/courses/${id}/archive`).then(d),
  restore: (id) => http.post(`/creator/courses/${id}/restore`).then(d),
  duplicate: (id) => http.post(`/creator/courses/${id}/duplicate`).then(d),
  curriculum: (id) => http.get(`/creator/courses/${id}/curriculum`).then(d),
  reorder: (id, sections) => http.put(`/creator/courses/${id}/curriculum/order`, { sections }).then(d),
  addSection: (id, body) => http.post(`/creator/courses/${id}/sections`, body).then(d),
  updateSection: (id, sid, body) => http.patch(`/creator/courses/${id}/sections/${sid}`, body).then(d),
  removeSection: (id, sid) => http.delete(`/creator/courses/${id}/sections/${sid}`).then(d),
  addLesson: (id, body) => http.post(`/creator/courses/${id}/lessons`, body).then(d),
  updateLesson: (id, lid, body) => http.patch(`/creator/courses/${id}/lessons/${lid}`, body).then(d),
  removeLesson: (id, lid) => http.delete(`/creator/courses/${id}/lessons/${lid}`).then(d),
};

export const rolesApi = {
  list: () => http.get('/creator/roles').then((r) => r.data),
  catalog: () => http.get('/creator/roles/permissions').then((r) => r.data),
  create: (body) => http.post('/creator/roles', body).then((r) => r.data),
  update: (id, body) => http.patch(`/creator/roles/${id}`, body).then((r) => r.data),
  remove: (id) => http.delete(`/creator/roles/${id}`).then((r) => r.data),
};

export const staffApi = {
  list: () => http.get('/creator/staff').then(d),
  invite: (body) => http.post('/creator/staff/invitations', body).then(d),
  revoke: (id) => http.delete(`/creator/staff/invitations/${id}`).then(d),
  changeRole: (id, roleKey) => http.patch(`/creator/staff/${id}`, { roleKey }).then(d),
  remove: (id) => http.delete(`/creator/staff/${id}`).then(d),
  lookupInvite: (token) => http.get(`/invitations/${encodeURIComponent(token)}`).then(d),
  acceptInvite: (token) => http.post('/invitations/accept', { token }).then(d),
  registerInvite: (body) => http.post('/invitations/register', body).then(d),
};

/**
 * Uploads a file directly to storage: begin (server validates type/size/quota) → PUT bytes to
 * the signed URL with progress → complete (server verifies size and content signature).
 */
export async function uploadFile(file, purpose, onProgress) {
  const begin = await http.post('/creator/files', { purpose, fileName: file.name, mimeType: file.type || 'application/octet-stream', sizeBytes: file.size }).then(d);
  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(begin.upload.method, begin.upload.url);
    for (const [k, v] of Object.entries(begin.upload.headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('Upload failed. Please try again.')));
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection.'));
    xhr.send(file);
  });
  return http.post(`/creator/files/${begin.fileId}/complete`).then(d);
}
