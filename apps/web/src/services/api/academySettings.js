import { http } from './client.js';

const d = (r) => r.data;

/** Academy settings sections modelled on Graphy: custom fields, communications, user experience, signup & login. */
export const academySettingsApi = {
  customFields: () => http.get('/creator/settings/custom-fields').then(d),
  createCustomField: (body) => http.post('/creator/settings/custom-fields', body).then(d),
  updateCustomField: (id, body) => http.patch(`/creator/settings/custom-fields/${id}`, body).then(d),
  deleteCustomField: (id) => http.delete(`/creator/settings/custom-fields/${id}`).then(d),
  answers: (userId) => http.get(`/creator/settings/custom-fields/answers/${userId}`).then(d),
  reorderCustomFields: (ids) => http.put('/creator/settings/custom-fields/order', { ids }).then(d),
  preferences: (section) => http.get(`/creator/settings/preferences/${section}`).then(d),
  savePreferences: (section, body) => http.put(`/creator/settings/preferences/${section}`, body).then(d),
};
