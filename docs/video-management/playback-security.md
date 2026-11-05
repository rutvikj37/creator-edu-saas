# Playback security

## Authorisation (`POST /api/v1/videos/:id/playback-authorize { lessonId }`, or the lesson player route `POST /api/v1/learn/lessons/:lessonId/video`)

1. student authenticated (tenant realm) on the academy's own host;
2. academy resolved from the host and the student's account (tenant isolation);
3. enrolment usable (active, not expired/revoked) — or the lesson is a free preview of a published course;
4. lesson published and not drip-locked;
5. the video is that lesson's video, belongs to the academy, and is `READY`;
6. at most **3 concurrent playback sessions** per student (active in the last 2 minutes) → 429;
7. a short-lived token is issued (see below) and a `VideoPlaybackSession` is recorded with the
   SHA-256 of the token (never the token), IP hash, user agent, expiry. Grants and denials are logged.

## Token

Bunny **embed token authentication**: `token = SHA256_hex(tokenAuthKey + videoId + expires)`,
`expires` = unix seconds. Lifetime = 2 × duration + 30 min, between 30 min and **6 h**.
The player URL is `https://iframe.mediadelivery.net/embed/{libraryId}/{videoId}?token=…&expires=…`.
No permanent or unsigned playback URL is ever returned; if `BUNNY_STREAM_TOKEN_AUTH_KEY` is missing,
playback is refused.

## During playback

* the player sends heartbeats every 15 s (and on pause/end) with the position from the player.js
  `timeupdate` event; position is saved for **resume**, and the lesson auto-completes at 90 %;
* each heartbeat re-checks the session: expired → 403 ("Reload the lesson"), revoked → 403,
  enrolment no longer usable → session revoked (`access_ended`) and 403; the player then unloads;
* postMessage events are accepted only from the embed origin and the embed window.

## Revocation — what it can and cannot do

* We stop issuing tokens immediately (enrolment ends, video deleted, lesson unpublished).
* An already-issued Bunny token stays valid until its `expires` (≤ 6 h); Bunny token auth has no
  per-token revocation. Our player stops at the next heartbeat, but someone who copied the embed URL
  could keep using it until expiry.

## This is not DRM

Token authentication controls **who gets a playable URL and for how long**. It does **not** encrypt
content per device (Widevine/FairPlay). Screen capture and determined stream ripping remain possible.
Bunny offers MediaCage DRM on some plans; `DrmPlaybackProvider` is the extension point for adding it.

## Other protections

Provider keys stay on the server; the webhook needs a secret and its body is never trusted;
upload credentials are per-video and expire; all routes are rate-limited (uploads 30/min,
playback 60/min per client by default) and audited (upload initiated/completed, update, delete).
