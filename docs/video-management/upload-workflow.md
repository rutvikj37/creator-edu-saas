# Upload workflow

## Steps

1. **Select** (creator, `/creator/videos`): drag & drop or file picker. The browser checks format
   (`GET /api/v1/videos/config` → allowed MIME types/extensions, max size) before contacting the server.
2. **Authorise** `POST /api/v1/videos/upload/initiate` `{ title, filename, size, mimeType, courseId?, lessonId? }`
   - authenticated workspace user with `courses.manage` (owner, admin, instructor);
   - tenant resolved from the authenticated membership (never from the body);
   - course/lesson must belong to the academy; **instructors only for courses they teach**; lesson must be a VIDEO lesson;
   - filename sanitised (no paths/control characters; letters in any script kept); format/extension/size validated;
   - `VideoAsset` created (`CREATED`), Bunny video created inside the academy's collection
     (`Academy-{tenantId}`, created once and stored in `TenantSetting video.bunnyCollectionId`);
   - `VideoUploadSession` created with a **12-hour** presigned TUS authorisation bound to this video;
   - response: `{ videoId, uploadSessionId, upload: { protocol: 'tus', endpoint, headers, metadata, expiresAt } }`.
     The library API key is never returned.
3. **Upload** directly to Bunny with `tus-js-client` (`apps/web/src/services/api/tusUpload.js`):
   resumable (resume state keyed to the provider video id + file), automatic retries
   (0 s, 3 s, 10 s, 30 s, 60 s), progress bar, **Cancel** (aborts and reports `cancelled`).
   The browser reports `started` (status `UPLOADING`).
4. **Complete** `POST /api/v1/videos/upload/complete` `{ videoId, uploadSessionId, outcome: success|failed|cancelled }`.
   `success` is only a hint: the backend reads the video from the Bunny API and advances the status
   only when Bunny reports it has the file. `failed` records the error (`FAILED`).
5. **Processing**: Bunny encodes. Status changes arrive by webhook (re-read from the API), by the
   library's polling (`GET /videos/:id/processing-status`, re-reads at most every 10 s) or by the
   5-minute worker sweep.
6. **Ready**: only `READY` videos can be assigned to lessons or published (`PATCH /videos/:id {lessonId}`
   or the lesson editor).

## Retry

* Upload failed/cancelled/expired → `initiate` again with `videoId`. The empty provider entry is
  reused; if Bunny reports *UploadFailed* (6), it is deleted and a new entry is created. A new
  `VideoUploadSession` (attempt n) gets fresh credentials; older sessions are marked `EXPIRED`.
* Processing failed (Bunny status 5) → `POST /videos/:id/retry-processing` (Bunny re-encode,
  `processingRound` +1 so later webhooks are not mistaken for duplicates).

## Status model

`CREATED → UPLOAD_AUTHORIZED → UPLOADING → UPLOADED → PROCESSING → READY`, plus `FAILED`,
`DELETING → DELETED`. Transitions are enforced (`videos.repository.ts`), applied with compare-and-set
on the current status, and every change is written to `VideoStatusHistory` with its source
(`USER`, `API`, `WEBHOOK`, `SYNC`, `WORKER`).

## Worker sweep (every 5 minutes)

* re-reads in-flight videos not synced for 2 minutes;
* **processing timeout**: `UPLOADED`/`PROCESSING` longer than `VIDEO_PROCESSING_TIMEOUT_MINUTES` → `FAILED`;
* expires upload authorisations; videos whose authorisation expired without a file → `FAILED`;
* **cleanup**: failed uploads untouched for 7 days → empty provider entry deleted;
* retries provider deletions left in `DELETING`.

## Deletion

`DELETE /api/v1/videos/:id` — refused while the video is used in a lesson or while its original is
being backed up (`PENDING`/`IN_PROGRESS`/`RETRYING`). Playback sessions are revoked, the video moves
to `DELETING`, the Bunny entry is deleted (or retried by the worker), then `DELETED`.
