# Live Classes & Webinars

Status: **Phase 9 shipped**: LiveKit (full) and meeting-link classes for Zoom/Meet/Teams (link + click attendance). The Zoom and Google Meet API adapters below remain design only. See DEVELOPMENT_PROGRESS → Phase 9.

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
`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, `ZOOM_SDK_KEY`, `ZOOM_SDK_SECRET`, `ZOOM_WEBHOOK_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
