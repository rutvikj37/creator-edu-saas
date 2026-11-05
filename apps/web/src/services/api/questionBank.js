import { http } from './client.js';

const d = (r) => r.data;

export const questionBankApi = {
  list: (params) => http.get('/creator/question-bank', { params }).then(d),
  tags: () => http.get('/creator/question-bank/tags').then(d),
  create: (body) => http.post('/creator/question-bank', body).then(d),
  update: (id, body) => http.put(`/creator/question-bank/${id}`, body).then(d),
  remove: (id) => http.delete(`/creator/question-bank/${id}`).then(d),
  addToQuiz: (courseId, lessonId, body) => http.post(`/creator/courses/${courseId}/lessons/${lessonId}/quiz/questions/from-bank`, body).then(d),
  saveToBank: (courseId, lessonId, questionId, tags) => http.post(`/creator/courses/${courseId}/lessons/${lessonId}/quiz/questions/${questionId}/save-to-bank`, { tags }).then(d),
};
