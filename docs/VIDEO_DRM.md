# Video Hosting & DRM

Status: **Phase 0 design** — implemented in Phase 6. DRM is reported as active **only** when a DRM-capable provider is configured and a license playback test passes (`VideoProvider.status = VERIFIED`, `drmCapable = true`).

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
