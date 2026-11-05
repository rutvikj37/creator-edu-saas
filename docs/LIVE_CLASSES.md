# Live Classes & Webinars

Status: **plugNmeet** (owner decision 2026-11-05: primary classroom for live classes and webinars), **LiveKit** (built-in classroom, kept) and **meeting links** for Zoom/Meet/Teams (link + click attendance). The Zoom and Google Meet API adapters below remain design only. See DEVELOPMENT_PROGRESS → Phase 9 and "plugNmeet".

## plugNmeet (self-hosted, platform-provided)

Source of truth for the integration: the official `plugnmeet-sdk-js` 2.3.0 and `plugnmeet-protocol-js` 1.6.3 (the plugNmeet docs site is not reachable from the build environment). Code: `apps/api/src/modules/live/plugnmeet.service.ts` (all server calls), `live.service.ts` (join/host/end/webhooks/sync), `live-recordings.service.ts` (worker imports).

| Step | What happens |
|---|---|
| Server calls | `POST {PLUGNMEET_URL}/auth/...` through the SDK: `API-KEY` header + `HASH-SIGNATURE` = HMAC-SHA256(body, API secret). Key and secret stay on the server. |
| Room | Created on the first join (host or attendee) when `isRoomActive` is false, with one creator at a time (Redis lock). Room id = the session's `roomName`. Settings from the class: title, waiting room (`waitingRoomFeatures.isActive`), cloud recording with auto-start (`recordingFeatures`), capacity + 5, webinar locks (attendees: mic/webcam/screen share/whiteboard/notepad/private chat locked, admin-only webcams, muted on start, participant list hidden), chat, whiteboard, shared notepad, polls, breakout rooms (classes), analytics. `emptyTimeout` 10 min. `logoutUrl` = academy `/learn/live`. |
| Join | Our access rules first (enrolment / batch / registration, join window, capacity), then `getJoinToken` with our identity (`usr_…`, `reg_…`, `host_…`) as `userId`/`exUserId`; host is admin + presenter; attendees `waitForApproval` when the waiting room is on. The browser gets only the client URL `{PLUGNMEET_URL}/?access_token=<token>`. |
| Webhooks | Set per room as `{API_PUBLIC_URL}/api/v1/webhooks/plugnmeet/<sessionId>/<secret>`; secret = HMAC(API secret, session id), compared in constant time. Events deduplicated by `id`; `room_started`, `room_finished` (session ends, attendance closed), `participant_joined/left` (attendance), `start_recording`, `end_recording`/`recording_proceeded`. |
| Sync (worker, every minute) | Live sessions: `getActiveRoomInfo` participants reconcile attendance (missed webhooks); a room that no longer exists 5 min after start ends the session. Ended sessions with recording: `fetchRecordings` (48 h window) registers each new record id once (`LiveRecording`). |
| Recording import (worker job, 5 attempts) | `getRecordingDownloadToken` → `GET {PLUGNMEET_URL}/download/recording/<token>` → **Bunny Stream** (server-side upload, then Bunny encodes; status history like any upload) or private storage when Bunny is not configured. Exact size from `Content-Length` (spooled to a temp file when absent; the listing's `fileSize` is a float and not used). Students watch through the normal access check: Bunny token-signed player or a signed storage URL. |

**To verify against a real plugNmeet server before production** (not reachable here): the client URL form `/?access_token=`, the recording download path `/download/recording/<token>`, webhook event names above, and that `isRoomActive` for an unknown room returns `ROOM_NOT_ACTIVE`/`ROOM_NOT_FOUND`. Webhook header signatures are not relied on (the URL secret authenticates).


## Zoom and Google Meet (academy's own accounts, OAuth)

Sources: Zoom's official Node SDK `@zoom/rivet` 0.4.0 (OAuth, REST paths and fields, webhook signing) and Google's official `@googleapis/calendar` 20.1.0 (Calendar events with Meet conferences). Zoom's and Google's developer sites are not reachable from the build environment. Code: `zoom.service.ts`, `google-meet.service.ts`, `live-integrations.service.ts`, `live.service.ts` (join/host/webhook).

| | Zoom | Google Meet |
|---|---|---|
| Connect | Live → Integrations → Zoom consent (`{ZOOM_OAUTH_BASE_URL}/oauth/authorize`), code exchanged with Basic client credentials; tokens encrypted; refresh-token rotation; Zoom user/account id kept for `app_deauthorized` | Google consent (offline, `calendar.events.owned` + email); refresh token encrypted; revoked on disconnect |
| Per session | `POST /users/me/meetings` (scheduled, start/duration/timezone, waiting room, `auto_recording: cloud` when recording, registration on); edits `PATCH`, cancel `DELETE`. Free Zoom plans refuse registration → meeting created without it | Calendar event on the primary calendar with `conferenceData.createRequest` (`hangoutsMeet`, `conferenceDataVersion=1`), `sendUpdates: none`; edits `PATCH`, cancel `DELETE` |
| Students | Access checks, then a personal registrant link (`POST /meetings/{id}/registrants`, created once per student and session); without registration the meeting link | Access checks, then the Meet link; the click is recorded as attendance |
| Host | Fresh `start_url` read before starting (it expires) | Meet link |
| Events | `POST /webhooks/zoom`: `x-zm-signature` = `v0=HMAC_SHA256(secret, "v0:{timestamp}:{body}")`; `endpoint.url_validation` answered; started/ended; participant joined/left → attendance (registrant → student, host, email → student, else guest); `recording.completed` → MP4 imported to the video library (Bunny) with the event's `download_token`; `app_deauthorized` → connection revoked | none (Meet attendance and recordings need Google Workspace APIs) |
| Failures | Meeting errors are stored on the session and retried by the worker every minute; a revoked grant marks the connection "needs attention" | same |

**To verify with real accounts before production**: Zoom — the scopes your Marketplace app needs (meeting write, registrant write, user read, recording read), the `?access_token=` download form for `download_token`, and that `recording.completed` carries `download_token` at the top level; Google — that the OAuth client's consent screen includes `calendar.events.owned` and that Meet links are created for the account type you use.

## Provider abstraction
```ts
interface LiveProvider {
  key: 'LIVEKIT' | 'ZOOM' | 'GOOGLE_MEET';
  capabilities: { embeddedRoom: boolean; recording: boolean; attendanceWebhooks: boolean; waitingRoom: boolean; };
  createRoom(session): Promise<{ providerRoomId; hostUrl? }>;
  issueJoin(session, user, role): Promise<{ token?; joinUrl? }>;
  endRoom(session): Promise<void>;
  startRecording?/stopRecording?(session);
  verifyWebhook(raw, headers): NormalizedLiveEvent;
}
```

| Provider | Classroom | Attendance | Recording | Notes |
|---|---|---|---|---|
| **LiveKit** (Cloud or self-hosted) — primary | Embedded in our app via `livekit-client` + `@livekit/components-react`: audio, video, screen share, participant list, host mute/remove (server API), chat via data channels | `participant_joined/left` webhooks → `LiveClassAttendance` | Egress API → S3 → imported as `VideoAsset` | Polls, Q&A, raise hand built on our API + data channel; whiteboard via embeddable integration (e.g. tldraw) |
| **Zoom** | Zoom Meeting SDK (web) embedded or join URL | `meeting.participant_joined/left` webhooks | Cloud recording webhook → import | Requires a Zoom Marketplace app (Server-to-Server OAuth + Meeting SDK keys) |
| **Google Meet** | External link (Meet cannot be embedded) | Meet REST API participant records (Workspace accounts only); otherwise "click-to-join" logging | Drive recordings (Workspace) | Creates events via Google Calendar API with OAuth |

No static/fake classroom: if no provider is configured, the "Create live class" form shows "Connect a live provider" and blocks creation.

## Flows
- Schedule (one-off or RRULE recurring) → sessions materialised 90 days ahead by scheduler.
- Reminders: 24 h, 1 h, 10 min (`live` queue, respects notification prefs).
- Join: `POST /learn/live/sessions/:id/join` checks enrollment/batch/ticket, capacity, time window (opens 15 min before) → provider token. Waiting room: participants join with `canPublish=false` until host admits.
- Attendance %: merged intervals / scheduled duration.
- Webinars: public registration form (free) or product checkout (paid) → ticket code → confirmation email → join.

## Env
`ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, `ZOOM_WEBHOOK_SECRET_TOKEN` (redirect `{API_PUBLIC_URL}/api/v1/integrations/zoom/callback`, events `{API_PUBLIC_URL}/api/v1/webhooks/zoom`), `GOOGLE_MEET_CLIENT_ID`, `GOOGLE_MEET_CLIENT_SECRET` (redirect `{API_PUBLIC_URL}/api/v1/integrations/google-meet/callback`), `PLUGNMEET_URL`, `PLUGNMEET_API_KEY`, `PLUGNMEET_API_SECRET` (plugNmeet `config.yaml` → `client.api_key/secret`), `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, `ZOOM_SDK_KEY`, `ZOOM_SDK_SECRET`, `ZOOM_WEBHOOK_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
