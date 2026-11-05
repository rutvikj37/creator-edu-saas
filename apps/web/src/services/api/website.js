import { http } from './client.js';

const d = (r) => r.data;

export const websiteApi = {
  overview: () => http.get('/creator/website').then(d),
  saveSettings: (body) => http.put('/creator/website/settings', body).then(d),
  aiLanding: (body) => http.post('/creator/website/ai-landing', body, { timeout: 180_000 }).then(d),
  page: (id) => http.get(`/creator/website/pages/${id}`).then(d),
  createPage: (body) => http.post('/creator/website/pages', body).then(d),
  deletePage: (id) => http.delete(`/creator/website/pages/${id}`).then(d),
  setHome: (id) => http.post(`/creator/website/pages/${id}/home`).then(d),
  savePage: (id, body) => http.patch(`/creator/website/pages/${id}`, body).then(d),
  publish: (id, note) => http.post(`/creator/website/pages/${id}/publish`, { note }).then(d),
  unpublish: (id) => http.post(`/creator/website/pages/${id}/unpublish`).then(d),
  versions: (id) => http.get(`/creator/website/pages/${id}/versions`).then(d),
  restore: (id, versionId) => http.post(`/creator/website/pages/${id}/versions/${versionId}/restore`).then(d),
  previewToken: () => http.post('/creator/website/preview-token').then(d),
  // academy host (public)
  layout: (preview) => http.get('/public/website/layout', { params: preview ? { preview } : {} }).then(d),
  publicPage: (slug, preview) => http.get(slug ? `/public/website/pages/${slug}` : '/public/website/pages/home', { params: preview ? { preview } : {} }).then(d),
};
