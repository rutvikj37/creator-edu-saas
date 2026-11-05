# Database design

All tables are tenant-scoped (`tenantId`), use composite `(tenantId, id)` keys for tenant-safe foreign
keys, and are registered in `TENANT_MODELS` so the tenant Prisma extension scopes every query.
Migration: `apps/api/prisma/migrations/20261105120000_video_bunny_backups` (additive; no data loss).

## `VideoAsset` (extended, not duplicated — referenced by lessons, live recordings and playback)

| Column | Notes |
|---|---|
| `provider` | `STORAGE` (Phase 6 private storage) or `BUNNY` |
| `providerAssetId` | Bunny video GUID; unique with `provider` |
| `status` | `CREATED, UPLOAD_AUTHORIZED, UPLOADING, UPLOADED, PROCESSING, READY, FAILED, DELETING, DELETED` |
| `protection` | `SIGNED` (storage URL) or `TOKEN` (Bunny embed token) |
| `courseId`, `lessonId` | optional association |
| `originalFilename`, `mimeType`, `originalSize` | from the upload (sanitised) |
| `durationSeconds`, `width`, `height`, `thumbnailUrl`, `availableResolutions`, `storageSize`, `encodeProgress`, `providerStatus`, `originalHash` | from the Bunny API |
| `processingRound`, `processingStartedAt`, `readyAt`, `lastSyncedAt`, `errorMessage` | processing bookkeeping |
| `sourceFileId` | now nullable (only STORAGE videos have a FileAsset) |
| `createdById`, `createdAt`, `updatedAt`, `deletedAt` | |

Indexes: `(tenantId, status, createdAt)`, `(status, updatedAt)`, `(tenantId, courseId)`, unique `(provider, providerAssetId)`.

## New tables

| Table | Purpose | Keys / indexes |
|---|---|---|
| `VideoStatusHistory` | every status change: from, to, source, reason | `(tenantId, videoAssetId, createdAt)` |
| `VideoUploadSession` | one per authorised upload attempt: status (`AUTHORIZED, UPLOADING, COMPLETED, FAILED, EXPIRED, CANCELLED`), attempt, authorisation expiry, timestamps, error | `(tenantId, videoAssetId, createdAt)`, `(uploadStatus, authorizationExpiresAt)` |
| `VideoProcessingEvent` | provider notifications (idempotency): `providerEventId` (hash of body + processing round), type, payload, result, processedAt | unique `(provider, providerEventId)` |
| `VideoBackup` | one per video: Drive file id, metadata file id, filename, sizes, SHA-256 of original, MD5 of encrypted object, wrapped key (`encryption`), status (`PENDING, IN_PROGRESS, COMPLETED, FAILED, RETRYING`), attempts, timestamps, error, restore status | unique `(tenantId, videoAssetId)`, `(status, updatedAt)` |
| `DocumentBackup` | same for lesson files (`fileAssetId`, `courseId`) | unique `(tenantId, fileAssetId)` |
| `VideoUsageRecord` | monthly snapshot per video: storage bytes, delivery bytes (allocated), watch seconds, views, `deliverySource` | unique `(videoAssetId, billingPeriod)`, `(tenantId, billingPeriod)` |

`VideoPlaybackSession` (existing) gained `sessionTokenHash` (SHA-256 of the issued token). Its existing
columns cover the spec's fields: `userId` (student), `createdAt` (started), `expiresAt`, `lastSeenAt`
(last activity), plus `revokedAt`/`revokeReason`, IP hash and user agent for access logging.

Platform-level state lives in `PlatformSetting`: `backups.googleDrive` (encrypted refresh token,
account email), video cost rates (`video.*`), `backups.driveLowSpacePercent`. Per academy:
`TenantSetting video.bunnyCollectionId`.
