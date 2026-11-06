import { http } from './client.js';

const d = (r) => r.data;
// Long polls are held by the server for up to 25 s, so they need a longer client timeout.
const LONG = { timeout: 35_000 };
const pollParams = (after, wait, signal) => ({ params: { ...(after ? { after } : {}), ...(wait ? { wait: 1 } : {}) }, signal, ...(wait ? LONG : {}) });

/** One conversation's transport, so the same thread UI serves all four chat surfaces. */
const thread = (base) => ({
  load: () => http.get(base).then(d),
  older: (before) => http.get(base, { params: { before } }).then(d),
  poll: (after, wait, signal) => http.get(`${base}/messages`, pollParams(after, wait, signal)).then(d),
  send: (body) => http.post(`${base}/messages`, { body }).then(d),
  read: () => http.post(`${base}/read`).then(d),
});

export const learnChatApi = thread('/learn/chat');
export const supportChatApi = thread('/creator/support-chat');

const inbox = (base) => ({
  list: (params) => http.get(base, { params }).then(d),
  thread: (id) => ({ ...thread(`${base}/${id}`), setStatus: (status) => http.post(`${base}/${id}/status`, { status }).then(d) }),
});
export const creatorChatApi = inbox('/creator/chat/conversations');
export const platformChatApi = inbox('/platform/support-chat/conversations');
