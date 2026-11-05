import { http } from './client.js';

const d = (r) => r.data;

export const videosApi = {
  list: () => http.get('/creator/videos').then(d),
  create: (body) => http.post('/creator/videos', body).then(d),
  update: (id, body) => http.patch(`/creator/videos/${id}`, body).then(d),
  preview: (id) => http.get(`/creator/videos/${id}/preview`).then(d),
  remove: (id) => http.delete(`/creator/videos/${id}`).then(d),
  start: (lessonId) => http.post(`/learn/lessons/${lessonId}/video`).then(d),
  heartbeat: (sessionId, body) => http.put(`/learn/video-sessions/${sessionId}/heartbeat`, body).then(d),
  end: (sessionId) => http.delete(`/learn/video-sessions/${sessionId}`).then(d),
  // Provider pipeline (/api/v1/videos)
  config: () => http.get('/videos/config').then(d),
  library: (params) => http.get('/videos', { params }).then(d),
  details: (id) => http.get(`/videos/${id}`).then(d),
  status: (id) => http.get(`/videos/${id}/processing-status`).then(d),
  edit: (id, body) => http.patch(`/videos/${id}`, body).then(d),
  destroy: (id) => http.delete(`/videos/${id}`).then(d),
  retryProcessing: (id) => http.post(`/videos/${id}/retry-processing`).then(d),
  initiate: (body) => http.post('/videos/upload/initiate', body).then(d),
  complete: (body) => http.post('/videos/upload/complete', body).then(d),
  playbackAuthorize: (id, lessonId) => http.post(`/videos/${id}/playback-authorize`, { lessonId }).then(d),
};

/** Reads a local video's duration (seconds) from its metadata before upload. */
export function readVideoDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(Number.isFinite(v.duration) ? Math.round(v.duration) : null); };
    v.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    v.src = url;
  });
}

function putBlob(url, blob, headers, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [k, v] of Object.entries(headers ?? {})) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded);
    xhr.onload = () => (xhr.status < 300 ? resolve(xhr.getResponseHeader('ETag')) : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(blob);
  });
}

/**
 * Uploads a video: single signed PUT, or (S3, >100 MB) parallel multipart with per-part retry.
 * Calls onProgress(0–100). Resolves with the verified file view.
 */
export async function uploadVideo(file, onProgress) {
  const begin = await http.post('/creator/files', { purpose: 'VIDEO_SOURCE', fileName: file.name, mimeType: file.type || 'video/mp4', sizeBytes: file.size }).then(d);
  if (begin.upload) {
    await putBlob(begin.upload.url, file, begin.upload.headers, (loaded) => onProgress?.(Math.round((loaded / file.size) * 100)));
    return http.post(`/creator/files/${begin.fileId}/complete`).then(d);
  }
  const { partSize, partCount } = begin.multipart;
  const loaded = new Array(partCount).fill(0);
  const report = () => onProgress?.(Math.round((loaded.reduce((a, b) => a + b, 0) / file.size) * 100));
  const parts = [];
  const numbers = Array.from({ length: partCount }, (_, i) => i + 1);
  for (let i = 0; i < numbers.length; i += 20) {
    const batch = numbers.slice(i, i + 20);
    const signed = await http.post(`/creator/files/${begin.fileId}/parts`, { partNumbers: batch }).then(d);
    // 4 parts in parallel; each part retried up to 3 times.
    for (let j = 0; j < signed.length; j += 4) {
      await Promise.all(signed.slice(j, j + 4).map(async ({ partNumber, url }) => {
        const blob = file.slice((partNumber - 1) * partSize, partNumber * partSize);
        for (let attempt = 1; ; attempt++) {
          try {
            const etag = await putBlob(url, blob, {}, (n) => { loaded[partNumber - 1] = n; report(); });
            parts.push({ partNumber, etag: etag ?? '' });
            return;
          } catch (e) {
            if (attempt >= 3) throw e;
            await new Promise((r) => setTimeout(r, 1000 * attempt));
          }
        }
      }));
    }
  }
  return http.post(`/creator/files/${begin.fileId}/complete`, { parts }).then(d);
}
