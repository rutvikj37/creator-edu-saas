import { http } from './client.js';

const d = (r) => r.data;

export const creatorLiveApi = {
  providers: () => http.get('/creator/live/providers').then(d),
  integrations: () => http.get('/creator/live/integrations').then(d),
  connectIntegration: (provider) => http.post(`/creator/live/integrations/${provider}/connect`).then(d),
  disconnectIntegration: (provider) => http.delete(`/creator/live/integrations/${provider}`).then(d),
  classes: (kind) => http.get('/creator/live/classes', { params: kind ? { kind } : {} }).then(d),
  create: (body) => http.post('/creator/live/classes', body).then(d),
  get: (id) => http.get(`/creator/live/classes/${id}`).then(d),
  update: (id, body) => http.patch(`/creator/live/classes/${id}`, body).then(d),
  cancel: (id) => http.post(`/creator/live/classes/${id}/cancel`).then(d),
  cancelSession: (id) => http.post(`/creator/live/sessions/${id}/cancel`).then(d),
  host: (id) => http.post(`/creator/live/sessions/${id}/host`).then(d),
  end: (id) => http.post(`/creator/live/sessions/${id}/end`).then(d),
  attendance: (id) => http.get(`/creator/live/sessions/${id}/attendance`).then(d),
  attendanceCsv: (id) => http.get(`/creator/live/sessions/${id}/attendance.csv`, { responseType: 'blob' }).then(d),
  recording: (id) => http.get(`/creator/live/sessions/${id}/recording`).then(d),
  admissions: (id) => http.get(`/creator/live/sessions/${id}/admissions`).then(d),
  decide: (id, admissionId, admit) => http.post(`/creator/live/sessions/${id}/admissions/${admissionId}`, { admit }).then(d),
  polls: (id) => http.get(`/creator/live/sessions/${id}/polls`).then(d),
  createPoll: (id, body) => http.post(`/creator/live/sessions/${id}/polls`, body).then(d),
  closePoll: (id, pollId) => http.post(`/creator/live/sessions/${id}/polls/${pollId}/close`).then(d),
  questions: (id) => http.get(`/creator/live/sessions/${id}/questions`).then(d),
  answer: (id, qid) => http.post(`/creator/live/sessions/${id}/questions/${qid}/answer`).then(d),
};

export const batchesApi = {
  list: () => http.get('/creator/batches').then(d),
  create: (body) => http.post('/creator/batches', body).then(d),
  get: (id) => http.get(`/creator/batches/${id}`).then(d),
  update: (id, body) => http.patch(`/creator/batches/${id}`, body).then(d),
  addMembers: (id, emails) => http.post(`/creator/batches/${id}/members`, { emails }).then(d),
  removeMember: (id, memberId) => http.post(`/creator/batches/${id}/members/${memberId}/remove`).then(d),
  archive: (id) => http.post(`/creator/batches/${id}/archive`).then(d),
};

/** Student side. */
export const learnLiveApi = {
  upcoming: () => http.get('/learn/live/upcoming').then(d),
  recordings: () => http.get('/learn/live/recordings').then(d),
  recording: (id) => http.get(`/learn/live/sessions/${id}/recording`).then(d),
  join: (id) => http.post(`/learn/live/sessions/${id}/join`).then(d),
  admission: (id) => http.get(`/learn/live/sessions/${id}/admission`).then(d),
  polls: (id) => http.get(`/learn/live/sessions/${id}/polls`).then(d),
  vote: (id, pollId, optionIndex) => http.post(`/learn/live/sessions/${id}/polls/${pollId}/vote`, { optionIndex }).then(d),
  questions: (id) => http.get(`/learn/live/sessions/${id}/questions`).then(d),
  ask: (id, text) => http.post(`/learn/live/sessions/${id}/questions`, { text }).then(d),
  upvote: (id, qid) => http.post(`/learn/live/sessions/${id}/questions/${qid}/upvote`).then(d),
};

/** Webinar pages and ticket holders (no account). */
export const webinarApi = {
  get: (slug) => http.get(`/public/webinars/${encodeURIComponent(slug)}`).then(d),
  register: (slug, body) => http.post(`/public/webinars/${encodeURIComponent(slug)}/register`, body).then(d),
  ticket: (code) => http.get(`/public/live/tickets/${encodeURIComponent(code)}`).then(d),
  join: (code, sessionId) => http.post(`/public/live/tickets/${encodeURIComponent(code)}/join`, { sessionId }).then(d),
  admission: (code, id) => http.get(`/public/live/tickets/${encodeURIComponent(code)}/sessions/${id}/admission`).then(d),
  polls: (code, id) => http.get(`/public/live/tickets/${encodeURIComponent(code)}/sessions/${id}/polls`).then(d),
  vote: (code, id, pollId, optionIndex) => http.post(`/public/live/tickets/${encodeURIComponent(code)}/sessions/${id}/polls/${pollId}/vote`, { optionIndex }).then(d),
  questions: (code, id) => http.get(`/public/live/tickets/${encodeURIComponent(code)}/sessions/${id}/questions`).then(d),
  ask: (code, id, text) => http.post(`/public/live/tickets/${encodeURIComponent(code)}/sessions/${id}/questions`, { text }).then(d),
};

/** Adapts the three participant flavours (host, student, ticket holder) to one interface for the room UI. */
export function participantApi(kind, sessionId, code) {
  const key = `${kind}:${sessionId}`;
  if (kind === 'host') {
    return {
      key,
      polls: () => creatorLiveApi.polls(sessionId), vote: null, createPoll: (b) => creatorLiveApi.createPoll(sessionId, b), closePoll: (pid) => creatorLiveApi.closePoll(sessionId, pid),
      questions: () => creatorLiveApi.questions(sessionId), ask: null, upvote: null, answer: (qid) => creatorLiveApi.answer(sessionId, qid),
    };
  }
  if (kind === 'ticket') {
    return {
      key,
      polls: () => webinarApi.polls(code, sessionId), vote: (pid, i) => webinarApi.vote(code, sessionId, pid, i), questions: () => webinarApi.questions(code, sessionId),
      ask: (t) => webinarApi.ask(code, sessionId, t), upvote: null, admission: () => webinarApi.admission(code, sessionId),
    };
  }
  return {
    key,
    polls: () => learnLiveApi.polls(sessionId), vote: (pid, i) => learnLiveApi.vote(sessionId, pid, i), questions: () => learnLiveApi.questions(sessionId),
    ask: (t) => learnLiveApi.ask(sessionId, t), upvote: (qid) => learnLiveApi.upvote(sessionId, qid), admission: () => learnLiveApi.admission(sessionId),
  };
}
