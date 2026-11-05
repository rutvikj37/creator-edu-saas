# Video management — architecture

## Responsibilities

| Concern | Owner |
|---|---|
| Storage, encoding, HLS adaptive streaming, thumbnails, CDN delivery | **Bunny Stream** (no transcoding in our code) |
| Upload authorisation, metadata, status, webhooks, playback authorisation, usage | **NestJS** (`apps/api/src/modules/videos`) |
| Video metadata and provider references | **MySQL** (`VideoAsset` + related tables) |
| Background work: provider syncs, maintenance, usage snapshots, backups, restores | **Redis + BullMQ** (`video`, `backups` queues, worker process) |
| Encrypted copies of original uploads and selected documents | **Google Drive** (`apps/api/src/modules/backups`) — never used for playback |

## Flow

```
Creator browser ──(1) POST /videos/upload/initiate──▶ NestJS ──create video──▶ Bunny API
      │                                               │
      │◀──(2) short-lived TUS credentials (no API key)┘
      │
      └──(3) TUS upload (resumable) ───────────────────────────▶ Bunny (encodes HLS, thumbnails)
                                                                    │
NestJS ◀──(4) webhook ?secret=… (hint only) ────────────────────────┘
   └──(5) GET video from Bunny API (source of truth) → status/metadata → MySQL
   └──(6) queue backup ──▶ worker: Bunny original ─▶ AES-256-GCM ─▶ Google Drive ─▶ verify

Student ──POST /videos/:id/playback-authorize──▶ NestJS (auth, academy, enrolment, lesson, tenant)
   ◀── token-signed Bunny embed URL (expires) ── player (HLS, speed, fullscreen) ── progress heartbeats
```

## Provider independence

* `VideoProvider` (`providers/video-provider.interface.ts`) is the only surface the services use; the
  `VIDEO_PROVIDER` token is bound to `BunnyStreamProvider` in `providers/bunny/bunny.module.ts`.
  Replacing Bunny = a new implementation + one binding.
* `BackupProvider` (`backups/providers/backup-provider.interface.ts`) is bound to Google Drive in
  `google-drive.module.ts`.
* `DrmPlaybackProvider` is a declared extension point for Widevine/FairPlay. **Not implemented** —
  Bunny token authentication is access control, not DRM.

## Modules

```
src/modules/videos/
  videos.module.ts            VideosModule (API) + VideosWorkerModule (worker)
  videos.controller.ts        /videos, /videos/webhooks/bunny, /platform/videos/usage, legacy /creator/videos, /learn/...
  videos.service.ts           library (both providers), lesson assignment, deletion, lesson playback entry point
  videos.repository.ts        status state machine (compare-and-set) + VideoStatusHistory
  dto/videos.dto.ts
  providers/video-provider.interface.ts
  providers/bunny/{bunny.module,bunny.service,bunny.client}.ts
  services/{video-upload,video-processing,video-playback,video-usage,video-webhook}.service.ts
  video.processor.ts          BullMQ: video-sync, video-maintain (5 min), video-usage (6 h)
src/modules/backups/
  backups.module.ts           BackupsModule (API) + BackupsWorkerModule (worker)
  backups.controller.ts       /backups…, Google OAuth callback
  backups.service.ts          backup orchestration, admin views, quota, sweep
  providers/backup-provider.interface.ts, providers/google-drive/{google-drive.module,google-drive.service}.ts
  services/{backup-crypto,backup-verification.service,backup-restore.service}.ts
  workers/video-backup.processor.ts   BullMQ: backup-video, backup-document, restore-video, backups-sweep (1 h)
```

`guards/` is not a separate folder: the existing global guards (`@TenantScoped`, `@RequirePermissions`,
`@RequireRealm`, throttling) are applied per route, so no new guard type was needed.

## Existing Phase 6 videos

`VideoAsset` is extended, not duplicated. Phase 6 "STORAGE" videos (private storage + signed URLs)
keep working and appear in the same library. When Bunny is not configured, the upload screen falls
back to storage uploads.
