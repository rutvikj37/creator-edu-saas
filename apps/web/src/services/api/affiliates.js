import { http } from './client.js';

const d = (r) => r.data;

export const affiliatesApi = {
  program: () => http.get('/creator/affiliates/program').then(d),
  saveProgram: (body) => http.put('/creator/affiliates/program', body).then(d),
  list: () => http.get('/creator/affiliates').then(d),
  conversions: (affiliateId) => http.get('/creator/affiliates/conversions', { params: affiliateId ? { affiliateId } : {} }).then(d),
  update: (id, body) => http.patch(`/creator/affiliates/${id}`, body).then(d),
  payout: (id, payoutRef) => http.post(`/creator/affiliates/${id}/payouts`, { payoutRef }).then(d),
  me: () => http.get('/learn/affiliate').then(d),
  join: (body) => http.post('/learn/affiliate/join', body).then(d),
  setPayoutDetails: (payoutDetails) => http.put('/learn/affiliate/payout-details', { payoutDetails }).then(d),
  click: (code, path) => http.post('/public/affiliates/click', { code, path }).then(d),
};

const KEY = 'ce.ref';

/** Records a ?ref= visit and remembers the code for the program's window (per academy, this browser only). */
export async function captureReferral(search, path) {
  const code = new URLSearchParams(search).get('ref');
  if (!code || !/^[A-Za-z0-9]{3,32}$/.test(code)) return;
  try {
    const r = await affiliatesApi.click(code, path);
    if (r.valid) localStorage.setItem(KEY, JSON.stringify({ code: code.toUpperCase(), until: Date.now() + r.cookieDays * 86_400_000 }));
  } catch {
    /* referral tracking must never break browsing */
  }
}

export function storedReferral() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return v && v.until > Date.now() ? v.code : null;
  } catch {
    return null;
  }
}
