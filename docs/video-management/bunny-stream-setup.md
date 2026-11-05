# Bunny Stream setup

## Verification sources

`docs.bunny.net` and the Bunny API hosts are **blocked by this build environment's network policy**,
so endpoints were verified against Bunny's **official packages** instead:

* `@bunny.net/openapi-client` 0.3.1 (generated from Bunny's OpenAPI specs) — the backend imports its
  types, so every request/response shape below is checked at compile time.
* `@bunny.net/stream-import` 0.1.1 and `@bunny.net/stream-react-native` 1.1.1 (official SDK code) —
  status codes and the player token formula.

| Item | Source | Status |
|---|---|---|
| `AccessKey` header, base URL `https://video.bunnycdn.com`, per-library API key | openapi-client middleware/README | ✅ verified |
| `POST /library/{id}/collections`, `POST /library/{id}/videos` (`title`, `collectionId`), `GET/DELETE /library/{id}/videos/{videoId}`, `POST …/reencode`, `PUT …/{videoId}` (upload) | OpenAPI types | ✅ verified |
| Video fields: `status`, `length`, `width`, `height`, `availableResolutions`, `thumbnailFileName`, `thumbnailUrl`, `storageSize`, `encodeProgress`, `hasOriginal`, `originalHash` (SHA-256) | OpenAPI `VideoModel` | ✅ verified |
| Status codes 0 Created, 1 Uploaded, 2 Processing, 3 Transcoding, 4 Finished, 5 Error, 6 UploadFailed, 7 JitSegmenting, 8 JitPlaylistsCreated (playable on JIT libraries) | official SDK enums | ✅ verified |
| `GET …/videos/{id}/play?token&expires` → `originalUrl`, `videoPlaylistUrl`, `tokenAuthEnabled` | OpenAPI `VideoPlayDataModel` | ✅ verified |
| `GET /library/{id}/statistics?dateFrom&dateTo&videoGuid` (views, watch time) | OpenAPI | ✅ verified |
| `GET https://api.bunny.net/videolibrary/{id}` with the account key → `StorageUsage`, `TrafficUsage` ("traffic usage this month"), `KeepOriginalFiles`, `PlayerTokenAuthenticationEnabled` | OpenAPI core types | ✅ verified |
| Player token = `SHA256_hex(tokenAuthKey + videoId + expires)` | official iOS SDK `generateEmbedToken` | ✅ verified |
| Embed URL `https://iframe.mediadelivery.net/embed/{libraryId}/{videoId}?token=&expires=` | domain seen in official SDK; path from Bunny docs | ⚠️ verify |
| TUS endpoint `https://video.bunnycdn.com/tusupload`, headers `AuthorizationSignature = SHA256_hex(libraryId + apiKey + expires + videoId)`, `AuthorizationExpire`, `VideoId`, `LibraryId` | Bunny docs ("TUS resumable uploads") | ⚠️ verify |
| Webhook body `VideoLibraryId`, `VideoGuid`, `Status` | Bunny docs | ⚠️ verify (only `VideoGuid`/`VideoLibraryId` are used, as a hint) |
| player.js postMessage events (`ready`, `timeupdate`, `play`, `pause`, `ended`, `setCurrentTime`) | Bunny docs ("Player.js") | ⚠️ verify |

Each ⚠️ item lives in one function/constant (`tusSignature`, `authorizePlayback`, `VideoWebhookService`,
`ProviderEmbed`), so a correction is a one-line change.

## Library settings

1. Create a **Stream library**. Note the **Library ID** and **API key** (library → API).
2. **Security → Embed view token authentication: on.** Copy the **Token authentication key** →
   `BUNNY_STREAM_TOKEN_AUTH_KEY`. Without it, protected playback is refused (we never fall back to
   unprotected URLs).
3. **Keep original files: on** (`KeepOriginalFiles`). Backups download the original from the
   play-data `originalUrl`; without originals, backups fail with a clear message.
4. **Webhook URL:** `https://<api-host>/api/v1/videos/webhooks/bunny?secret=<BUNNY_STREAM_WEBHOOK_SECRET>`.
5. Optional: **Allowed referrers** = your academy domains (defence in depth for embeds).
6. Optional: account API key → `BUNNY_ACCOUNT_API_KEY` for library storage/traffic totals.

## Environment

```
BUNNY_STREAM_API_KEY=            # library API key (server only)
BUNNY_STREAM_LIBRARY_ID=
BUNNY_STREAM_CDN_HOSTNAME=       # vz-xxxx.b-cdn.net
BUNNY_STREAM_WEBHOOK_SECRET=     # ≥ 24 random chars
BUNNY_STREAM_TOKEN_AUTH_KEY=
BUNNY_ACCOUNT_API_KEY=           # optional
VIDEO_MAX_UPLOAD_BYTES=21474836480
VIDEO_PROCESSING_TIMEOUT_MINUTES=180
```

## Error handling

`BunnyClient`: 20 s timeout per request; up to 3 retries with exponential backoff + jitter (honours
`Retry-After`, capped at 30 s) on 429, 5xx, timeouts and network errors — for reads and deletes only.
Creates are never retried automatically (no duplicate videos). Errors become `BunnyApiError` and are
mapped to API responses without provider details (`provider-error.ts`): 401/403 → "rejected the
platform credentials" (503), retryable → "busy or unreachable" (503), 404 → not found.
