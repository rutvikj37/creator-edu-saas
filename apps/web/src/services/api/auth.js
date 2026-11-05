import { http } from './client.js';

/** Reads the double-submit CSRF cookie (dev: csrf, production: __Host-csrf). */
export function readCsrfCookie() {
  const pairs = document.cookie.split(';').map((c) => c.trim().split('='));
  const hit = pairs.find(([k]) => k === '__Host-csrf') ?? pairs.find(([k]) => k === 'csrf');
  return hit ? decodeURIComponent(hit[1]) : null;
}

const d = (r) => r.data;

export const authApi = {
  providers: () => http.get('/auth/providers').then(d),
  registerCreator: (body) => http.post('/auth/register/creator', body).then(d),
  registerStudent: (body) => http.post('/auth/register/student', body).then(d),
  login: (body) => http.post('/auth/login', body).then(d),
  loginMfa: (body) => http.post('/auth/login/2fa', body).then(d),
  refresh: () => {
    const csrf = readCsrfCookie();
    if (!csrf) return Promise.reject(Object.assign(new Error('No session'), { status: 401, code: 'UNAUTHENTICATED' }));
    return http.post('/auth/refresh', null, { headers: { 'X-CSRF-Token': csrf }, skipAuthRefresh: true }).then(d);
  },
  logout: () => http.post('/auth/logout').then(d),
  logoutAll: () => http.post('/auth/logout-all').then(d),
  me: () => http.get('/auth/me').then(d),
  switchTenant: (tenantId) => http.post('/auth/switch-tenant', { tenantId }).then(d),
  sessions: () => http.get('/auth/sessions').then(d),
  revokeSession: (id) => http.delete(`/auth/sessions/${id}`).then(d),
  verifyEmail: (token) => http.post('/auth/email/verify', { token }).then(d),
  verifyEmailCode: (code) => http.post('/auth/email/verify-code', { code }).then(d),
  resendVerification: () => http.post('/auth/email/resend').then(d),
  forgotPassword: (email) => http.post('/auth/password/forgot', { email }).then(d),
  resetPassword: (body) => http.post('/auth/password/reset', body).then(d),
  changePassword: (body) => http.post('/auth/password/change', body).then(d),
  setup2fa: () => http.post('/auth/2fa/setup').then(d),
  enable2fa: (code) => http.post('/auth/2fa/enable', { code }).then(d),
  disable2fa: (body) => http.post('/auth/2fa/disable', body).then(d),
  googleHandoff: (code) => http.post('/auth/google/handoff', { code }).then(d),
};

export const academyApi = {
  site: () => http.get('/public/site').then(d),
};

export const workspaceApi = {
  workspace: () => http.get('/creator/workspace').then(d),
  members: () => http.get('/creator/members').then(d),
  domains: () => http.get('/creator/domains').then(d),
  addDomain: (hostname) => http.post('/creator/domains', { hostname }).then(d),
  subdomainAvailability: (name) => http.get('/creator/domains/subdomains/availability', { params: { name } }).then(d),
  addSubdomain: (name) => http.post('/creator/domains/subdomains', { name }).then(d),
  verifyDomain: (id) => http.post(`/creator/domains/${id}/verify`).then(d),
  makePrimary: (id) => http.patch(`/creator/domains/${id}/primary`).then(d),
  removeDomain: (id) => http.delete(`/creator/domains/${id}`).then(d),
};
