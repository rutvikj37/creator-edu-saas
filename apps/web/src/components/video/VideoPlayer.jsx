import { Watermark } from './Watermark.jsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from '../auth/Alert.jsx';
import { Skeleton } from '../ui/index.js';
import { videosApi } from '../../services/api/videos.js';

const HEARTBEAT_MS = 15_000;
const PJS = { context: 'player.js', version: '0.0.11' };

/**
 * Bunny Stream embed with the player.js postMessage interface, used for resume and progress.
 * Messages are accepted only from the embed's own origin and window.
 */
export function ProviderEmbed({ url, resumeAt, onTime, onState, title = 'Lesson video' }) {
  const frame = useRef(null);
  const origin = new URL(url).origin;
  useEffect(() => {
    let resumed = false;
    const send = (method, value) => frame.current?.contentWindow?.postMessage(JSON.stringify({ ...PJS, method, value, listener: method }), origin);
    const onMessage = (e) => {
      if (e.origin !== origin || e.source !== frame.current?.contentWindow) return;
      let m;
      try { m = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
      if (m?.context !== 'player.js') return;
      if (m.event === 'ready') {
        for (const ev of ['timeupdate', 'play', 'pause', 'ended']) send('addEventListener', ev);
        if (resumeAt > 5 && !resumed) { resumed = true; send('setCurrentTime', resumeAt); }
      } else if (m.event === 'timeupdate' && m.value) onTime?.(Number(m.value.seconds) || 0, Number(m.value.duration) || undefined);
      else if (['play', 'pause', 'ended'].includes(m.event)) onState?.(m.event);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [origin, resumeAt, onTime, onState]);
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
      <iframe ref={frame} title={title} src={url} className="absolute inset-0 size-full border-0" loading="lazy"
        allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" data-testid="lesson-video-embed" />
    </div>
  );
}

/**
 * Plays a lesson video through a server-issued playback session: a signed storage URL (native
 * <video>) or a token-authenticated Bunny Stream embed (adaptive HLS, fullscreen, speed controls).
 * Sends position heartbeats (resume + auto-complete) and ends the session on unmount.
 * Not DRM — access is signed and short-lived, but a determined user can still capture the stream.
 */
export function VideoPlayer({ lessonId, onCompleted }) {
  const ref = useRef(null);
  const session = useRef(null);
  const last = useRef({ position: 0, duration: undefined });
  const playing = useRef(false);
  const [play, setPlay] = useState(null);
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
      if (session.current && (e.status === 403 || e.status === 404)) {
        ref.current?.pause();
        session.current = null;
        setPlay(null);
        setError(e.message);
      }
    }
  }, [onCompleted]);

  useEffect(() => {
    let cancelled = false;
    setPlay(null);
    setError(null);
    playing.current = false;
    last.current = { position: 0, duration: undefined };
    videosApi.start(lessonId).then(
      (s) => {
        if (cancelled) {
          videosApi.end(s.sessionId).catch(() => {});
          return;
        }
        session.current = s;
        setPlay(s);
      },
      (e) => !cancelled && setError(e.message),
    );
    const t = setInterval(() => {
      if (ref.current ? !ref.current.paused : playing.current) beat();
    }, HEARTBEAT_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
      const s = session.current;
      if (s) beat().finally(() => videosApi.end(s.sessionId).catch(() => {}));
      session.current = null;
    };
  }, [lessonId, beat]);

  const onTime = useCallback((position, duration) => { last.current = { position, duration }; }, []);
  const onState = useCallback((state) => {
    playing.current = state === 'play';
    if (state !== 'play') beat();
  }, [beat]);

  if (error) return <Alert tone="error" title="Video unavailable">{error}</Alert>;
  if (!play) return <Skeleton className="aspect-video w-full" />;
  if (play.kind === 'iframe') return <div className="relative"><ProviderEmbed url={play.url} resumeAt={play.resumeAt} onTime={onTime} onState={onState} /><Watermark /></div>;
  return (
    <div className="relative">
    <video
      ref={ref}
      src={play.url}
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
    <Watermark />
    </div>
  );
}
