# Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Upload screen says videos are stored privately | `BUNNY_STREAM_API_KEY` / `BUNNY_STREAM_LIBRARY_ID` not set; the Phase 6 storage path is used. |
| `503 Video hosting is not configured` | as above. |
| `503 The video provider rejected the platform credentials` | wrong library API key (it must be the **library** key, not the account key). |
| TUS upload fails immediately with 401/403 | presigned signature rejected: check the formula in `tusSignature()` against Bunny's current docs, the server clock (expiry is unix time), and that `LibraryId` matches. |
| Upload finished but status stays `UPLOADING` | Bunny has not reported the file yet. The library re-reads every 10 s; the worker every 5 min; check the webhook URL and secret in Bunny. |
| Status never leaves `PROCESSING` | after `VIDEO_PROCESSING_TIMEOUT_MINUTES` it becomes `FAILED`; use **Retry processing**. |
| Webhook returns 404 | `BUNNY_STREAM_WEBHOOK_SECRET` unset or shorter than 24 characters. |
| Webhook returns 401 | the `?secret=` in Bunny's webhook URL differs from the environment. |
| Students see "Playback is not available right now" | `BUNNY_STREAM_TOKEN_AUTH_KEY` missing; enable embed token authentication and set the key. |
| Player shows Bunny "token expired"/403 | server clock skew or token key mismatch; tokens last 30 min–6 h. |
| Resume/progress not saved for Bunny videos | the player.js events did not arrive: confirm player.js support in the current Bunny player and that the embed origin is `iframe.mediadelivery.net`. Students can still use **Mark complete**. |
| "Too many devices" (429) | 3 concurrent sessions per student; sessions idle > 2 min stop counting. |
| Backup `PENDING` "Waiting for Google Drive" | connect Drive in Super Admin → Backups; the hourly sweep resumes them. |
| Backup failed: "no original file" | enable **Keep original files** in the Bunny library (applies to new uploads). |
| Backup failed: "Google Drive access was revoked or expired" | reconnect. If it happens weekly, the OAuth app is still in *Testing* — publish it. |
| Backup failed: "Google Drive is full" / "Not enough free space" | free space or upgrade; then **Retry**. |
| Backup failed: "SHA-256 differs" | the original changed in transit or Bunny's hash differs; **Retry**. Persistent → investigate before deleting anything. |
| Restore failed: "integrity check" | the Drive copy is corrupted or the wrong `BACKUP_ENCRYPTION_KEY` is configured. |
| Usage dashboard shows no provider totals | set `BUNNY_ACCOUNT_API_KEY`. Cost shows "—" until rates are set in Settings → Video costs. |
