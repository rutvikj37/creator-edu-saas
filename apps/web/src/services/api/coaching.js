import { http } from './client.js';

const d = (r) => r.data;
const page = (r) => ({ items: r.data.items ?? r.data, meta: r.data.meta ?? r.meta });

export const coachingApi = {
  // academy
  stats: () => http.get('/creator/coaching/stats').then(d),
  programs: () => http.get('/creator/coaching/programs').then(d),
  program: (id) => http.get(`/creator/coaching/programs/${id}`).then(d),
  create: (body) => http.post('/creator/coaching/programs', body).then(d),
  update: (id, body) => http.patch(`/creator/coaching/programs/${id}`, body).then(d),
  setStatus: (id, status) => http.post(`/creator/coaching/programs/${id}/status`, { status }).then(d),
  bookings: (params) => http.get('/creator/coaching/bookings', { params }).then(page),
  setBookingStatus: (id, status) => http.post(`/creator/coaching/bookings/${id}/status`, { status }).then(d),
  team: () => http.get('/creator/coaching/team').then(d),
  profile: (userId) => http.get(`/creator/coaching/availability/${userId ?? 'me'}`).then(d),
  saveProfile: (userId, body) => http.put(`/creator/coaching/availability/${userId ?? 'me'}`, body).then(d),
  connectGoogle: (userId) => http.post(`/creator/coaching/availability/${userId ?? 'me'}/google/connect`).then(d),
  disconnectGoogle: (userId) => http.post(`/creator/coaching/availability/${userId ?? 'me'}/google/disconnect`).then(d),
  // public
  publicList: () => http.get('/public/coaching').then(d),
  publicGet: (slug) => http.get(`/public/coaching/${slug}`).then(d),
  // student
  mine: () => http.get('/learn/coaching').then(d),
  claim: (programId) => http.post(`/learn/coaching/${programId}/claim`).then(d),
  slots: (programId, sessionId) => http.get(`/learn/coaching/${programId}/sessions/${sessionId}/slots`).then(d),
  book: (programId, body) => http.post(`/learn/coaching/${programId}/bookings`, body).then(d),
  cancel: (bookingId) => http.post(`/learn/coaching/bookings/${bookingId}/cancel`).then(d),
  attachment: (bookingId, fileId) => http.post(`/learn/coaching/bookings/${bookingId}/attachments/${fileId}`).then(d),
};
