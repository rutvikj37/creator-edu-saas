import { http } from './client.js';

const d = (r) => r.data;
const page = (r) => ({ items: r.data, meta: r.meta });

export const marketingApi = {
  leads: (params) => http.get('/creator/leads', { params }).then(page),
  lead: (id) => http.get(`/creator/leads/${id}`).then(d),
  updateLead: (id, body) => http.patch(`/creator/leads/${id}`, body).then(d),
  eraseLead: (id) => http.delete(`/creator/leads/${id}`).then(d),
  importLeads: (rows, consentConfirmed) => http.post('/creator/leads/import', { rows, consentConfirmed }).then(d),
  campaigns: () => http.get('/creator/campaigns').then(d),
  campaign: (id) => http.get(`/creator/campaigns/${id}`).then(d),
  createCampaign: (body) => http.post('/creator/campaigns', body).then(d),
  updateCampaign: (id, body) => http.patch(`/creator/campaigns/${id}`, body).then(d),
  testCampaign: (id) => http.post(`/creator/campaigns/${id}/test`).then(d),
  scheduleCampaign: (id, at) => http.post(`/creator/campaigns/${id}/schedule`, at ? { at } : {}).then(d),
  cancelCampaign: (id) => http.post(`/creator/campaigns/${id}/cancel`).then(d),
  automations: () => http.get('/creator/automations').then(d),
  automation: (id) => http.get(`/creator/automations/${id}`).then(d),
  createAutomation: (body) => http.post('/creator/automations', body).then(d),
  updateAutomation: (id, body) => http.patch(`/creator/automations/${id}`, body).then(d),
  deleteAutomation: (id) => http.delete(`/creator/automations/${id}`).then(d),
};

/** Parses pasted CSV/lines: email[,name[,tag1;tag2]]. A header row starting with "email" is skipped. */
export function parseContacts(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l, i) => !(i === 0 && /^email\b/i.test(l)))
    .map((l) => {
      const [email, name, tags] = l.split(',').map((x) => x?.trim());
      return { email, ...(name ? { name } : {}), ...(tags ? { tags: tags.split(';').map((t) => t.trim()).filter(Boolean) } : {}) };
    });
}
