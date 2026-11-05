import * as tus from 'tus-js-client';

/**
 * Direct browser → Bunny Stream upload over TUS (resumable). The backend supplies short-lived,
 * video-bound signature headers; no API key ever reaches the browser. tus-js-client remembers the
 * upload URL per file (fingerprint), so a retry or page reload resumes instead of starting over.
 * Returns { promise, abort }.
 */
export function startTusUpload(file, auth, { onProgress, onStart } = {}) {
  let upload;
  let started = false;
  const promise = new Promise((resolve, reject) => {
    upload = new tus.Upload(file, {
      endpoint: auth.endpoint,
      headers: auth.headers,
      metadata: { ...auth.metadata },
      retryDelays: [0, 3000, 10000, 30000, 60000],
      removeFingerprintOnSuccess: true,
      // Resume state is keyed to this provider video, so credentials always match the stored upload.
      fingerprint: async (f) => ['bunny', auth.headers.VideoId, f.name, f.size, f.lastModified].join(':'),
      onProgress: (sent, total) => {
        if (!started) { started = true; onStart?.(); }
        onProgress?.(total ? Math.min(100, Math.floor((sent / total) * 100)) : 0);
      },
      onError: (err) => reject(new Error(err?.message?.split('\n')[0] || 'Upload failed')),
      onSuccess: () => resolve(),
    });
    upload.findPreviousUploads().then((previous) => {
      if (previous[0]) upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    }, () => upload.start());
  });
  return { promise, abort: () => upload?.abort(true).catch(() => {}) };
}
