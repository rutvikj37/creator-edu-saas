import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from '../auth/Alert.jsx';
import { Skeleton } from '../ui/index.js';
import { videosApi } from '../../services/api/videos.js';

const HEARTBEAT_MS = 15_000;

/**
 * Plays a lesson video through a server-issued playback session.
 * Sends position heartbeats (resume + auto-complete) and ends the session on unmount.
 * Not DRM — the URL is signed and short-lived, but a determined user can still capture the stream.
 */
export function VideoPlayer({ lessonId, onCompleted }) {
  const ref = useRef(null);
  const session = useRef(null);
  const last = useRef({ position: 0, duration: undefined });
  const [src, setSrc] = useState(null);
  const [error, setError] = useState(null);

  const beat = useCallback(async () => {
    const v = ref.current;
    const s = session.current;
    if (!s) return;
    // On unmount the element is already detached, so fall back to the last observed position.
    if (v) last.current = { position: v.currentTime, duration: v.duration };
    const { position, duration } = last.current;
    try {
      const r = await videosApi.heartbeat(s.sessionId, {
        positionSeconds: Math.floor(position),
        durationSeconds: Number.isFinite(duration) ? Math.round(duration) : undefined,
      });
      if (r?.completed) onCompleted?.();
    } catch (e) {
      if (ref.current && (e.status === 403 || e.status === 404)) {
        ref.current.pause();
        session.current = null;
        setSrc(null);
        setError(e.message);
      }
    }
  }, [onCompleted]);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setError(null);
    last.current = { position: 0, duration: undefined };
    videosApi.start(lessonId).then(
      (s) => {
        if (cancelled) {
          videosApi.end(s.sessionId).catch(() => {});
          return;
        }
        session.current = s;
        setSrc(s.url);
      },
      (e) => !cancelled && setError(e.message),
    );
    const t = setInterval(() => {
      if (ref.current && !ref.current.paused) beat();
    }, HEARTBEAT_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
      const s = session.current;
      if (s) {
        beat().finally(() => videosApi.end(s.sessionId).catch(() => {}));
      }
      session.current = null;
    };
  }, [lessonId, beat]);

  if (error) return <Alert tone="error" title="Video unavailable">{error}</Alert>;
  if (!src) return <Skeleton className="aspect-video w-full" />;
  return (
    <video
      ref={ref}
      src={src}
      controls
      playsInline
      preload="metadata"
      controlsList="nodownload"
      onContextMenu={(e) => e.preventDefault()}
      onLoadedMetadata={(e) => {
        const at = session.current?.resumeAt;
        if (at && at < e.currentTarget.duration - 5) e.currentTarget.currentTime = at;
      }}
      onTimeUpdate={(e) => {
        last.current = { position: e.currentTarget.currentTime, duration: e.currentTarget.duration };
      }}
      onPause={beat}
      onEnded={beat}
      className="aspect-video w-full rounded-lg bg-black"
      data-testid="lesson-video"
    />
  );
}
