import { http } from './client.js';

const d = (r) => r.data;

export const catalogApi = {
  courses: (params) => http.get('/public/courses', { params }).then(d),
  course: (slug) => http.get(`/public/courses/${encodeURIComponent(slug)}`).then(d),
  preview: (slug, lessonId) => http.get(`/public/courses/${encodeURIComponent(slug)}/preview/${lessonId}`).then(d),
  verifyCertificate: (number) => http.get(`/public/certificates/${encodeURIComponent(number)}`).then(d),
};

export const learnApi = {
  enrollments: () => http.get('/learn/enrollments').then(d),
  enroll: (courseId) => http.post(`/learn/courses/${courseId}/enroll`).then(d),
  player: (courseId) => http.get(`/learn/courses/${courseId}/player`).then(d),
  lesson: (id) => http.get(`/learn/lessons/${id}`).then(d),
  position: (id, positionSeconds) => http.put(`/learn/lessons/${id}/position`, { positionSeconds }).then(d),
  complete: (id) => http.post(`/learn/lessons/${id}/complete`).then(d),
  uncomplete: (id) => http.delete(`/learn/lessons/${id}/complete`).then(d),
  bookmark: (id) => http.post(`/learn/lessons/${id}/bookmark`).then(d),
  notes: (courseId) => http.get(`/learn/courses/${courseId}/notes`).then(d),
  addNote: (lessonId, body) => http.post(`/learn/lessons/${lessonId}/notes`, { body }).then(d),
  updateNote: (id, body) => http.patch(`/learn/notes/${id}`, { body }).then(d),
  deleteNote: (id) => http.delete(`/learn/notes/${id}`).then(d),
  comments: (lessonId) => http.get(`/learn/lessons/${lessonId}/comments`).then(d),
  comment: (lessonId, body, parentId) => http.post(`/learn/lessons/${lessonId}/comments`, { body, parentId }).then(d),
  quiz: (lessonId) => http.get(`/learn/lessons/${lessonId}/quiz`).then(d),
  startQuiz: (lessonId) => http.post(`/learn/lessons/${lessonId}/quiz/attempts`).then(d),
  attempt: (id) => http.get(`/learn/quiz-attempts/${id}`).then(d),
  answer: (id, body) => http.put(`/learn/quiz-attempts/${id}/answers`, body).then(d),
  submitQuiz: (id) => http.post(`/learn/quiz-attempts/${id}/submit`).then(d),
  assignment: (lessonId) => http.get(`/learn/lessons/${lessonId}/assignment`).then(d),
  submitAssignment: (lessonId, body) => http.post(`/learn/lessons/${lessonId}/assignment/submission`, body).then(d),
  certificates: () => http.get('/learn/certificates').then(d),
  certificatePdf: (id) => http.get(`/learn/certificates/${id}/pdf`, { responseType: 'blob' }).then((r) => r.data),
};

/** Student upload (purpose SUBMISSION) through the same verified two-step flow. */
export async function uploadSubmission(file, onProgress) {
  const begin = await http.post('/learn/files', { purpose: 'SUBMISSION', fileName: file.name, mimeType: file.type || 'application/octet-stream', sizeBytes: file.size }).then(d);
  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', begin.upload.url);
    for (const [k, v] of Object.entries(begin.upload.headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error('Upload failed')));
    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.send(file);
  });
  return http.post(`/learn/files/${begin.fileId}/complete`).then(d);
}

export const creatorLearnApi = {
  students: (params) => http.get('/creator/students', { params }).then((r) => ({ items: r.data, meta: r.meta })),
  student: (id) => http.get(`/creator/students/${id}`).then(d),
  courseEnrollments: (courseId) => http.get(`/creator/courses/${courseId}/enrollments`).then(d),
  enroll: (courseId, email) => http.post(`/creator/courses/${courseId}/enrollments`, { email }).then(d),
  revoke: (id) => http.delete(`/creator/enrollments/${id}`).then(d),
  discussions: (params) => http.get('/creator/discussions', { params }).then(d),
  reply: (id, body) => http.post(`/creator/discussions/${id}/replies`, { body }).then(d),
  moderate: (id, action) => http.post(`/creator/discussions/${id}/moderate`, { action }).then(d),
  quiz: (courseId, lessonId) => http.get(`/creator/courses/${courseId}/lessons/${lessonId}/quiz`).then(d),
  quizSettings: (courseId, lessonId, body) => http.put(`/creator/courses/${courseId}/lessons/${lessonId}/quiz`, body).then(d),
  addQuestion: (courseId, lessonId, body) => http.post(`/creator/courses/${courseId}/lessons/${lessonId}/quiz/questions`, body).then(d),
  updateQuestion: (courseId, lessonId, qid, body) => http.put(`/creator/courses/${courseId}/lessons/${lessonId}/quiz/questions/${qid}`, body).then(d),
  removeQuestion: (courseId, lessonId, qid) => http.delete(`/creator/courses/${courseId}/lessons/${lessonId}/quiz/questions/${qid}`).then(d),
  attempts: (quizId) => http.get(`/creator/quizzes/${quizId}/attempts`).then(d),
  attemptDetail: (id) => http.get(`/creator/quiz-attempts/${id}`).then(d),
  gradeAttempt: (id, grades) => http.post(`/creator/quiz-attempts/${id}/grade`, { grades }).then(d),
  assignment: (courseId, lessonId) => http.get(`/creator/courses/${courseId}/lessons/${lessonId}/assignment`).then(d),
  assignmentSettings: (courseId, lessonId, body) => http.put(`/creator/courses/${courseId}/lessons/${lessonId}/assignment`, body).then(d),
  submissions: (assignmentId) => http.get(`/creator/assignments/${assignmentId}/submissions`).then(d),
  gradeSubmission: (id, body) => http.post(`/creator/submissions/${id}/grade`, body).then(d),
  template: () => http.get('/creator/certificates/template').then(d),
  updateTemplate: (body) => http.put('/creator/certificates/template', body).then(d),
  certificates: () => http.get('/creator/certificates').then(d),
  revokeCertificate: (id, reason) => http.post(`/creator/certificates/${id}/revoke`, { reason }).then(d),
  reinstateCertificate: (id) => http.post(`/creator/certificates/${id}/reinstate`).then(d),
};
