# API reference

Base path `/api/v1`. Responses use the standard envelope `{ success, data, meta? }` / `{ success:false, error:{ code, message, details? } }`.

## Creator (workspace; `courses.read` to read, `courses.manage` to change)

| Method & path | Body / query | Result |
|---|---|---|
| `GET /videos/config` | — | `{ provider: 'BUNNY'|'STORAGE', maxUploadBytes, mimeTypes, extensions }` |
| `POST /videos/upload/initiate` | `{ title, filename, size, mimeType, courseId?, lessonId?, videoId? }` (`videoId` = retry) | 201 `{ videoId, uploadSessionId, upload: { protocol:'tus', endpoint, headers, metadata, expiresAt } }` |
| `POST /videos/upload/complete` | `{ videoId, uploadSessionId, outcome: 'started'|'success'|'failed'|'cancelled', error? }` | video view (status confirmed with Bunny) |
| `GET /videos` | `?status&courseId&q` | list (both providers), with backup status, course, lessons |
| `GET /videos/:id` | — | details: ids, provider id, course, lessons, file info, duration, resolution, storage, status, backup, upload sessions, status history |
| `PATCH /videos/:id` | `{ title?, courseId?, lessonId? }` (assigning needs `READY`) | video view |
| `DELETE /videos/:id` | — | `{ deleted: true }`; 409 if used in a lesson or backup in progress |
| `GET /videos/:id/processing-status` | — | `{ status, encodeProgress, errorMessage, durationSeconds, readyAt, lastSyncedAt, backup }` (re-reads Bunny ≤ every 10 s while in flight) |
| `POST /videos/:id/retry-processing` | — | status; only `FAILED` videos whose file reached Bunny |
| `GET /videos/:id/preview` | — | `{ kind: 'iframe'|'file', url, expiresAt }` (1-hour token) |

Errors: 422 validation (`mimeType`, `filename`, `size`, `lessonId`), 403 permission / instructor not on
course, 404 cross-tenant or unknown, 409 state conflict, 503 provider not configured / rejected
credentials / busy.

## Student (academy host, tenant realm)

| Method & path | Body | Result |
|---|---|---|
| `POST /videos/:id/playback-authorize` | `{ lessonId }` | `{ sessionId, player:{ kind:'iframe', url }, protection:'token', drm:false, expiresAt, durationSeconds, resumeAt, preview }` |
| `POST /learn/lessons/:lessonId/video` | — | same for Bunny videos (`kind:'iframe'`), signed file URL for storage videos |
| `PUT /learn/video-sessions/:id/heartbeat` | `{ positionSeconds, durationSeconds? }` | `{ ok, completed }`; 403 expired/revoked/access ended |
| `DELETE /learn/video-sessions/:id` | — | `{ ended: true }` |

403 not enrolled / locked, 404 wrong video or other academy, 429 more than 3 devices.

## Webhook

`POST /videos/webhooks/bunny?secret=<BUNNY_STREAM_WEBHOOK_SECRET>` (public). 401 wrong secret,
404 when no secret is configured, 422 malformed. Always 200 otherwise:
`{ received, status }`, `{ duplicate: true }`, `{ ignored }`, or `{ deferred: true }` (provider
unreachable; retried from the queue).

## Platform (Super Admin; `platform.system.read` to view, `platform.settings.manage` to change)

| Method & path | Notes |
|---|---|
| `GET /platform/videos/usage?period=YYYY-MM` | totals, provider usage, backups, per-academy storage/delivery/watch time/estimated cost/fair-use flag |
| `GET /backups?kind=video|document&status&tenantId&page&pageSize` | paginated |
| `GET /backups/:id` | |
| `POST /backups/:id/retry` | `FAILED`/`PENDING`/`RETRYING` only |
| `POST /backups/:id/restore` | completed video backups; verified before upload |
| `GET /backups/drive/quota` | connection + `{ limit, usage, usageInDrive, usageInDriveTrash, free, freePercent, lowSpace }` |
| `GET /backups/drive/status` | `{ configured, connected, email, connectedAt, scope }` |
| `POST /backups/drive/oauth/start` | `{ url }` (Google consent) |
| `GET /backups/drive/oauth/callback` | public; Google redirect; validates one-time `state`; redirects to `/super-admin/backups?drive=connected|error` |
| `POST /backups/drive/disconnect` | revokes and deletes the token |
| `POST /backups/documents` | `{ courseId }` → `{ queued }` |

## Legacy (Phase 6, kept)

`GET/POST /creator/videos`, `PATCH/DELETE /creator/videos/:id`, `GET /creator/videos/:id/preview`.
