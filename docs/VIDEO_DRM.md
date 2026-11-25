# Video Hosting & DRM

Status: **MediaCage Basic (free) shipped 2026-11-25.** Bunny Stream libraries can enable clear-key MediaCage Basic DRM on the embed player (`BUNNY_STREAM_MEDIACAGE_BASIC=true`, default). Playback still uses short-lived embed tokens; with Basic on, Bunny encrypts the stream per session. This is **not** Widevine/FairPlay L1 (that is MediaCage Enterprise / VdoCipher — still future). Honest API fields: `drm: true`, `drmTier: 'basic'`, `protection: 'mediacage_basic'`.

## MediaCage Basic (current)

| Item | Detail |
|---|---|
| Cost | ₹0 / $0 (included with Bunny Stream) |
| How | Library `EnableDRM=true`, `DrmVersion=0` (Basic) or `2` (Basic V2, default). Auto via Core API when `BUNNY_ACCOUNT_API_KEY` is set; otherwise enable in Bunny dashboard. |
| Player | **Embed only** (`iframe.mediadelivery.net/embed/...`) — already our path |
| Side effects | `AllowEarlyPlay` and `ExposeOriginals` must be false; MP4 fallback / early-play disabled |
| Limits | Clear-key encryption; keys reach the client; screen capture still possible. Not a Learnyst L1 replacement. |

Env: `BUNNY_STREAM_MEDIACAGE_BASIC`, `BUNNY_STREAM_DRM_VERSION` (0 or 2), plus existing Bunny token/auth keys.

## Honest capability matrix

| Provider adapter | Transcoding / ABR | Protection | Widevine / FairPlay / PlayReady | Watermark |
|---|---|---|---|---|
| **VdoCipher** | Managed | DRM by default, OTP + playbackInfo per view | Yes (Widevine + FairPlay; PlayReady via Widevine on Edge) | Dynamic watermark via annotation param (server-generated) |
| **Mux** | Managed HLS | Signed playback IDs (JWT); Mux DRM where enabled on the account | Only if Mux DRM is enabled for the account | Overlay rendered by our player |
| **AWS (S3 + MediaConvert + CloudFront)** | HLS (+ DASH/CMAF) renditions | CloudFront signed cookies + AES-128 HLS encryption | **Not DRM by itself.** Real DRM requires SPEKE + a key/license provider (e.g., a commercial multi-DRM service) — adapter slot provided, needs contract + credentials | Overlay rendered by our player |

S3 alone never provides DRM; a public S3 URL is never used for playback.

## Upload pipeline
1. `POST /creator/uploads` (purpose `VIDEO_SOURCE`, size, mime) → validate plan storage → S3 **multipart** create → presigned part URLs.
2. Browser uploads parts in parallel with progress, retry per part, resume using stored `uploadId` + listed parts.
3. `POST /creator/uploads/:id/complete` → verify size/ETag → `FileAsset READY` → `VideoAsset UPLOADED` → `video` queue: push to provider (VdoCipher/Mux import by signed S3 URL, or MediaConvert job).
4. Provider webhook / SNS → `PROCESSING` → `READY` (renditions, duration, thumbnail) or `FAILED` (error surfaced in UI, retry button).
5. Usage: storage bytes recorded; bandwidth pulled from provider/CloudFront logs daily into `UsageRecord`.

## Playback authorization
`POST /learn/video/:assetId/playback`:
- Checks: active enrollment (not expired/revoked), lesson unlocked (drip), tenant active, device limit, concurrent session limit.
- Creates `VideoPlaybackSession` (jti, 5-min token TTL, renewable by heartbeat).
- Returns provider-specific payload: VdoCipher `{otp, playbackInfo}` with watermark annotation; Mux signed playback + DRM token; AWS signed cookies scoped to the asset path.
- Revocation: refund/revoke → sessions revoked, heartbeat denied.
- Secrets (VdoCipher API secret, Mux signing key, CloudFront private key, DRM keys) never leave the server.

## Watermark
`WatermarkSetting` (tenant default, course override): fields name / masked email (`ra****@g***.com`) / student id / timestamp, position fixed or moving, opacity, interval. Rendered by provider (VdoCipher) or our player overlay (other providers). Overlay is a deterrent, not cryptographic protection — documented as such.

## PDF protection
Private S3; viewer endpoint renders a per-student watermarked copy (pdf-lib stamped on each page in a worker, cached per user for TTL) served by short-lived signed URL; download allowed only if `CourseResource.downloadable`; every view/download logged in `PdfAccessLog`; access respects enrollment expiry.

## Env
`AWS_REGION`, `S3_PRIVATE_BUCKET`, `S3_PUBLIC_BUCKET`, `CLOUDFRONT_DOMAIN`, `CLOUDFRONT_KEY_PAIR_ID`, `CLOUDFRONT_PRIVATE_KEY`, `MEDIACONVERT_ROLE_ARN`, `MEDIACONVERT_ENDPOINT`, `VDOCIPHER_API_SECRET`, `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, `MUX_SIGNING_KEY_ID`, `MUX_SIGNING_PRIVATE_KEY`, `MUX_WEBHOOK_SECRET`.
