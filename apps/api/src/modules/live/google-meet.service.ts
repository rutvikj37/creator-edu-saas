import { Injectable } from '@nestjs/common';
import { calendar_v3 } from '@googleapis/calendar';
import { randomUUID } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { AppConfig } from '../../config/app-config.service.js';

/** Google rejected or could not be reached. */
export class GoogleMeetError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly status?: number) {
    super(message);
  }
}

/** Create/edit/delete events only on calendars the academy owns; email identifies the account. */
export const GOOGLE_MEET_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.events.owned'];

export interface MeetEventInput {
  summary: string;
  description?: string | null;
  start: Date;
  end: Date;
  timezone: string;
}

const classify = (e: unknown) => {
  const status = Number((e as { response?: { status?: number }; code?: number }).response?.status ?? (e as { code?: number }).code) || undefined;
  const msg = (e as { response?: { data?: { error?: { message?: string } | string; error_description?: string } }; message?: string }).response?.data;
  const text = typeof msg?.error === 'string' ? `${msg.error}${msg.error_description ? `: ${msg.error_description}` : ''}` : msg?.error?.message ?? (e as Error).message;
  return new GoogleMeetError(`Google: ${text}`, !status || status >= 500 || status === 429, status);
};

/**
 * Google Meet through Google Calendar: each session is a Calendar event on the academy's primary
 * calendar with a Meet conference (`conferenceData.createRequest` with type `hangoutsMeet`,
 * `conferenceDataVersion=1`), using the official `@googleapis/calendar` client. No invitations
 * are sent (`sendUpdates: none`); students get the Meet link from the academy.
 */
@Injectable()
export class GoogleMeetService {
  constructor(private readonly config: AppConfig) {}

  isConfigured() {
    return Boolean(this.config.get('GOOGLE_MEET_CLIENT_ID') && this.config.get('GOOGLE_MEET_CLIENT_SECRET'));
  }

  redirectUri() {
    return `${this.config.get('API_PUBLIC_URL').replace(/\/+$/, '')}/api/v1/integrations/google-meet/callback`;
  }

  private oauth() {
    const root = this.config.get('GOOGLE_API_ROOT_URL');
    return new OAuth2Client({
      clientId: this.config.get('GOOGLE_MEET_CLIENT_ID'), clientSecret: this.config.get('GOOGLE_MEET_CLIENT_SECRET'), redirectUri: this.redirectUri(),
      ...(root ? { endpoints: { oauth2TokenUrl: `${root.replace(/\/$/, '')}/token`, oauth2RevokeUrl: `${root.replace(/\/$/, '')}/revoke` } } : {}),
    });
  }

  authorizeUrl(state: string) {
    // offline + consent: Google returns a refresh token so sessions can be created later without the creator.
    return this.oauth().generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: GOOGLE_MEET_SCOPES, state, include_granted_scopes: false });
  }

  /** Exchanges the code; the email comes from the ID token issued in the same token response. */
  async exchangeCode(code: string) {
    const { tokens } = await this.oauth().getToken(code).catch((e) => { throw classify(e); });
    if (!tokens.refresh_token) throw new GoogleMeetError('Google did not return a refresh token. Remove the app’s access in your Google account and connect again.', false, 400);
    let email: string | null = null;
    let subject: string | null = null;
    if (tokens.id_token) {
      try {
        const claims = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString('utf8')) as { email?: string; sub?: string };
        email = claims.email ?? null;
        subject = claims.sub ?? null;
      } catch { /* email stays unknown */ }
    }
    return { refreshToken: tokens.refresh_token, email, subject, scopes: tokens.scope ?? GOOGLE_MEET_SCOPES.join(' ') };
  }

  private calendar(refreshToken: string) {
    const auth = this.oauth();
    auth.setCredentials({ refresh_token: refreshToken });
    const root = this.config.get('GOOGLE_API_ROOT_URL');
    return new calendar_v3.Calendar({ auth, ...(root ? { rootUrl: root.endsWith('/') ? root : `${root}/` } : {}) } as never);
  }

  private event(e: MeetEventInput) {
    return {
      summary: e.summary.slice(0, 200), description: e.description?.slice(0, 4000) ?? undefined,
      start: { dateTime: e.start.toISOString(), timeZone: e.timezone }, end: { dateTime: e.end.toISOString(), timeZone: e.timezone },
      guestsCanInviteOthers: false, guestsCanSeeOtherGuests: false,
    };
  }

  private meetLink(ev: calendar_v3.Schema$Event) {
    return ev.hangoutLink ?? ev.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri ?? null;
  }

  async createEvent(refreshToken: string, e: MeetEventInput) {
    try {
      const res = await this.calendar(refreshToken).events.insert({
        calendarId: 'primary', conferenceDataVersion: 1, sendUpdates: 'none',
        requestBody: { ...this.event(e), conferenceData: { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } } },
      });
      const link = this.meetLink(res.data);
      if (!res.data.id || !link) throw new GoogleMeetError('Google created the event without a Meet link (Meet may be turned off for this account)', false);
      return { eventId: res.data.id, joinUrl: link };
    } catch (err) {
      throw err instanceof GoogleMeetError ? err : classify(err);
    }
  }

  async updateEvent(refreshToken: string, eventId: string, e: MeetEventInput) {
    try {
      await this.calendar(refreshToken).events.patch({ calendarId: 'primary', eventId, sendUpdates: 'none', requestBody: this.event(e) });
    } catch (err) {
      throw classify(err);
    }
  }

  async deleteEvent(refreshToken: string, eventId: string) {
    try {
      await this.calendar(refreshToken).events.delete({ calendarId: 'primary', eventId, sendUpdates: 'none' });
    } catch (err) {
      const c = classify(err);
      if (c.status === 404 || c.status === 410) return; // already deleted
      throw c;
    }
  }

  async revoke(refreshToken: string) {
    await this.oauth().revokeToken(refreshToken).catch(() => undefined);
  }
}
