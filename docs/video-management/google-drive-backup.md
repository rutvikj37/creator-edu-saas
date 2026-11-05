# Google Drive backups

## What is backed up

* the **original upload** of every Bunny video (downloaded from Bunny's play-data `originalUrl`;
  requires "Keep original files" on the library);
* **selected documents**: all lesson files of a course, on request (`POST /api/v1/backups/documents { courseId }`).

Students never receive Drive file IDs or URLs; playback always comes from Bunny.

## Verification sources

`developers.google.com` is blocked by this build environment, so the integration uses Google's
**official SDKs** and their generated type definitions: `@googleapis/drive` 27 (Drive v3) and
`google-auth-library` 11 (OAuth2). Field names used (`storageQuota.limit/usage/usageInDrive/usageInDriveTrash`,
`md5Checksum`, `sha256Checksum`, `size`, `appProperties`, folder MIME `application/vnd.google-apps.folder`,
`generateAuthUrl({ access_type, prompt, scope, state })`, `getToken`, `revokeToken`) come from those
packages. Account-policy facts below (refresh-token expiry, upload caps) are Google policy from memory
and must be checked against the current Google documentation.

## Setup

1. Google Cloud console → project → enable **Google Drive API**.
2. OAuth consent screen: **External**, scope `https://www.googleapis.com/auth/drive.file` only
   (the app sees only files it creates). **Publish the app to "In production"**: refresh tokens of apps
   left in *Testing* stop working after about 7 days, which would silently stop backups.
3. OAuth client (Web application). Authorised redirect URI:
   `https://<api-host>/api/v1/backups/drive/oauth/callback` → `GOOGLE_DRIVE_REDIRECT_URI`.
4. `BACKUP_ENCRYPTION_KEY=$(openssl rand -base64 32)`. **Store a copy offline** (password manager /
   vault). Without it, no backup can be decrypted — by design.
5. Super Admin → **Backups → Connect Google Drive** and approve with the 5 TB account.

## Connection security

* `access_type=offline` + `prompt=consent` → refresh token; a one-time `state` (10 min, Redis) binds
  the callback to the admin who started it.
* The refresh token is encrypted with AES-256-GCM (`ENCRYPTION_KEY`) in `PlatformSetting
  backups.googleDrive` (`isSecret`), never returned by any endpoint, never sent to the browser.
* **Disconnect** revokes the token at Google and deletes it.

## Folder structure

```
TechX-LMS-Backups/
  Academy-{tenantId}/
    Courses/
      Course-{courseId | unassigned}/
        Videos/      {videoId}{ext}.enc
        Documents/   {fileAssetId}{ext}.enc
        Metadata/    {videoId|fileAssetId}.json   (ids, sizes, SHA-256, wrapped key — no secrets)
    Database/        (created for future database exports; nothing is written there by this module)
```

Folder IDs are cached in Redis (30 days). Nothing is ever shared or made public.

## Encryption

Per file: random 256-bit data key; stream encrypted with **AES-256-GCM** while uploading
(format `TXB1 | version | IV | ciphertext | tag`). The data key is stored only wrapped with
`BACKUP_ENCRYPTION_KEY` (DB `VideoBackup.encryption` and the Drive metadata file).

## Processing (worker, `backups` queue, concurrency 1)

1. After Bunny confirms the upload, the video pipeline queues `backup-video` (does not wait for it).
2. Not connected → `PENDING` ("waiting for Google Drive"); the hourly sweep picks it up after connecting.
3. Free-space check (`about.storageQuota`; needs file size × 1.05).
4. Stream: Bunny original → encrypt → Drive upload (official SDK, multipart streaming). Nothing is
   written to local disk.
5. **Verify**: Drive `size` and `md5Checksum` equal what was streamed; plaintext size equals the
   recorded upload size; plaintext SHA-256 equals Bunny's `originalHash` (when Bunny provides one).
   Any mismatch → the uploaded copy is deleted and the attempt fails.
6. Metadata file written; status `COMPLETED`.

Statuses: `PENDING → IN_PROGRESS → COMPLETED`, or `RETRYING` (retryable error; BullMQ retries with
exponential backoff, 5 attempts from 1 min) → `FAILED`. Admins can **Retry**. The source original
stays at Bunny; deleting a video is refused while its backup is pending/in progress.

Retryable: Drive 429/5xx, `rateLimitExceeded`/`userRateLimitExceeded`/`backendError`, network errors,
Bunny 429/5xx. Not retryable: Drive full (`storageQuotaExceeded`), revoked access (`invalid_grant`),
missing original, checksum mismatch on the final attempt.

## Restore

`POST /api/v1/backups/:id/restore` (Super Admin): **verification pass first** (download, decrypt,
GCM tag, SHA-256 and size against the record) → new Bunny video in the academy collection → decrypted
stream uploaded server-side (`PUT /library/{id}/videos/{videoId}`) → the `VideoAsset` points to the new
entry (`PROCESSING`, Bunny re-encodes; lessons keep working) → old entry deleted. A tampered or
corrupted backup is refused before anything is uploaded.

## Quota monitoring

`GET /api/v1/backups/drive/quota` → limit, usage, usageInDrive, trash, free, free %, `lowSpace` when
free % is below `backups.driveLowSpacePercent` (default 10 %). The hourly sweep logs a warning when low.

## Known limitations

* Uploads use the SDK's streaming multipart upload, not the resumable protocol: an interrupted large
  backup restarts from the beginning on retry (the original is re-read from Bunny).
* Google applies per-user daily upload limits (documented as 750 GB/day at the time of writing —
  check current limits). A large backlog can take several days.

## Risks of a personal Google account for commercial backups

* **Terms**: consumer Google accounts are for personal use; check Google's terms for storing business
  data of third parties (academies). Google Workspace (Business) is the supported route.
* **Single point of failure**: one person's account. Account suspension, a lost password/2FA device,
  or the person leaving the company makes every backup unreachable. There is no admin recovery or
  audit trail as in Workspace.
* **Quota and policy changes** apply to consumer plans without business notice; storage shared with
  Gmail/Photos on the same account.
* **Data protection**: you are the data controller for students' content; a personal account has no
  data-processing agreement (DPA) or data-residency commitment. Encryption reduces, but does not
  remove, this exposure.
* **Key custody**: the encryption key is now as critical as the data; losing it loses every backup.
* **Not a second region**: Drive is a copy, not tested disaster recovery. Run a restore drill
  periodically (restore a video into a test academy).

Recommendation: move to a Google Workspace shared drive (or object storage with versioning and
object lock) as soon as practical; the `BackupProvider` interface makes that a contained change.
