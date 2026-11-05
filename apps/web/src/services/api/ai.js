import { http } from './client.js';

const d = (r) => r.data;

export const aiApi = {
  usage: () => http.get('/creator/ai/usage').then(d),
  settings: () => http.get('/creator/ai/settings').then(d),
  saveSettings: (body) => http.put('/creator/ai/settings', body).then(d),
  outline: (body) => http.post('/creator/ai/course-outline', body, { timeout: 180_000 }).then(d),
  applyOutline: (courseId, sections) => http.post(`/creator/ai/courses/${courseId}/apply-outline`, { sections }).then(d),
  lessonDraft: (body) => http.post('/creator/ai/lesson-draft', body, { timeout: 180_000 }).then(d),
  quizQuestions: (body) => http.post('/creator/ai/quiz-questions', body, { timeout: 180_000 }).then(d),
  tutorStatus: () => http.get('/learn/ai/tutor').then(d),
  ask: (body) => http.post('/learn/ai/tutor', body, { timeout: 120_000 }).then(d),
};
