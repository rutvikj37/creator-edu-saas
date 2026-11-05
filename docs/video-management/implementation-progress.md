# Implementation progress — Video Management & Processing

Owner instruction (2026-11-05): "Work on full plan" — all phases implemented in one pass, with tests
run and this record updated after each phase (instead of pausing for approval between phases).

| Phase | Scope | Status |
|---|---|---|
| 0 | Repository and schema inspection, architecture, API/DB design, integration requirements | ✅ |
| 1 | Schema, Bunny adapter, video creation, direct (TUS) upload authorisation | ✅ |
| 2 | Webhooks, processing status, status history, timeouts, retries, cleanup, creator library | ✅ |
| 3 | Playback authorisation, Bunny player, resume and progress | ✅ |
| 4 | Google Drive OAuth, encrypted backups, verification, retries, quota, restore, documents | ✅ |
| 5 | Usage tracking, Super Admin dashboards, security tests, documentation | ✅ |

## Phase 0 findings

* Existing `VideoAsset`/`VideoPlaybackSession` (Phase 6: private storage, signed URLs, heartbeats,
  3-device limit, auto-complete) are referenced by lessons, live recordings and the player → **extended**,
  not duplicated. Courses/lessons live in `modules/courses`; enrolment/lesson access in
  `LearningService.accessibleLesson` (reused for playback checks).
* BullMQ already had a `video` queue; a `backups` queue was added.
* Network policy blocks `docs.bunny.net`, Bunny APIs, `developers.google.com`. Bunny and Google facts
  were verified against their **official npm packages** (see `bunny-stream-setup.md`,
  `google-drive-backup.md`). Repository access to Bunny's native SDK sources was not granted.

## Delivered

**API**: provider interface + Bunny adapter (types checked against Bunny's official OpenAPI types;
timeouts, retries, backoff, error mapping) · `/videos/upload/initiate|complete` with ownership,
instructor-course, format/size checks, sanitised filenames, per-academy Bunny collections, presigned
12-hour TUS credentials · status machine with compare-and-set + history · webhook with URL secret,
idempotent event store, status always re-read from the Bunny API, deferred retry via queue ·
processing status refresh, retry-processing, timeout detection, upload-expiry and abandoned-entry
cleanup, deletion with retry · playback authorisation (enrolment, publication, locks, tenant,
READY), Bunny embed token, session with token hash, concurrency limit, revocation on heartbeat,
access logging · Google Drive OAuth (offline, `drive.file`, one-time state, encrypted refresh token,
revoke on disconnect) · streaming AES-256-GCM backups with per-file wrapped keys, folder hierarchy,
metadata files, size/MD5/SHA-256 verification, BullMQ retries (5 attempts, exponential), admin retry,
quota with low-space flag, verified restore to a new Bunny entry, course document backups · monthly
usage snapshots (storage per video; Bunny monthly library traffic allocated by watch time),
configurable rates/currency/fair-use thresholds, Super Admin usage API.

**Web**: video library (thumbnail, title, duration, size, processing and backup status, upload date,
course, actions: preview, edit title, assign to lesson, details, delete) · upload panel (drag & drop,
validation, resumable TUS upload with progress, cancel, retry, processing progress) · details drawer
(internal/Bunny ids, course/lessons, file, duration, resolution, storage, status, backup, history,
refresh/retry) · student player: token-authenticated Bunny embed with resume and progress
(postMessage, origin-checked) and the existing native player for storage videos · Super Admin
Backups (Drive connect/disconnect, quota bar, low-space alert, video/document backups, retry,
restore, course document backup) and Video usage (totals, provider usage, Drive free space,
backups, per-academy table with estimated cost and fair-use flag) · settings group "Video costs".

## Tests

* API e2e **108 ✅** (21 files). New: `video-bunny.e2e-spec.ts` (8), `backups.e2e-spec.ts` (7),
  `video-usage.e2e-spec.ts` (1); existing Phase 6 video and isolation suites still pass.
* API unit **103 ✅** (Bunny client retries/backoff/timeouts/error mapping, status mapping, token and
  TUS formulas, filename sanitising incl. Indic scripts, state machine, TXB1 encryption round-trip and
  tamper/truncation/wrong-key detection, key wrapping, Drive error classification, upload verification).
* Web **96 ✅** (upload validation, Bunny upload flow, cancel/retry, library/details, embed origin
  checks, admin backups/usage pages).
* Browser (dev): creator library — rejected format, upload (storage fallback), details drawer; no
  console or 5xx errors.

Required scenarios → tests: 1 creator upload · 2 unauthorised upload (student, sales manager,
instructor not on course) · 3 cross-tenant upload/read/update/delete/complete/retry · 4 upload retry
(reuse and replacement of the provider entry) · 5 webhook status update · 6 duplicate and forged
webhooks · 7 failed processing + retry-processing · 8 authorised playback (token formula, session
hash, progress, completion) · 9 unauthorised playback (not enrolled, other academy, wrong video,
staff) · 10 expired session, device limit, revocation · 11 Drive backup success · 12 retryable
failure → RETRYING → FAILED → admin retry; hash mismatch never kept · 13 quota and low space, refusal
when full · 14 restore (exact bytes, old entry removed) and tampered backup refused · 15 tenant-wise
usage with allocation, rates and fair use.

## How the tests reach Bunny and Google

Neither service is reachable from this environment, and there are no credentials. The suites use
stand-ins that follow the official API shapes: `test/bunny-sim.ts` (in-process fetch, checks
`AccessKey`) and `test/drive-sim.ts` (a real local HTTP server for OAuth token/revoke and Drive v3,
driven by Google's official SDK unchanged). The stand-ins are test-only; production code talks to
the real services.

## Outstanding — must be verified with real accounts before production

1. **Bunny TUS presigned signature** (`tusSignature`) and endpoint — from Bunny docs, not verifiable here.
2. **Embed URL path** `/embed/{libraryId}/{videoId}` and **player.js events** (resume/progress).
3. **Webhook body field names** (`VideoGuid`, `VideoLibraryId`) — status itself is always re-read.
4. **`originalUrl` download** with "Keep original files" on (auth requirements of that URL).
5. Google OAuth app **published to Production** (Testing-mode refresh tokens expire ≈ 7 days).
6. A real end-to-end run: upload a large file, watch on desktop/mobile, check backup and restore.
7. Load: backups are sequential (concurrency 1) and restart from zero on failure (no resumable
   Drive upload); Google per-user daily upload caps apply.

## Not in scope (as instructed)

Deployment, servers, Docker, Nginx, SSL, domains, FFmpeg/transcoding, DRM (interface only),
automatic customer charging.
