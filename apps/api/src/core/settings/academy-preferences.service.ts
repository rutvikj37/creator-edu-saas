import { Global, Inject, Injectable, Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { AppException } from '../../common/errors/app-exception.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../redis/redis.constants.js';

/** Learner emails an academy can switch off (Settings → Communications). Security and login emails always go out. */
export const TOGGLEABLE_EMAILS = [
  { tag: 'student-invite', name: 'Learner welcome — added by you', description: 'Sent when you add or import learners on the dashboard' },
  { tag: 'enrolled', name: 'Course welcome', description: 'Sent when a learner is enrolled in a course' },
  { tag: 'purchase-receipt', name: 'Purchase receipt', description: 'Sent after a successful payment' },
  { tag: 'refund-issued', name: 'Refund notice', description: 'Sent when an order is refunded' },
  { tag: 'webinar-registration', name: 'Webinar registration', description: 'Sent when someone registers for a free webinar' },
  { tag: 'webinar-ticket', name: 'Webinar ticket', description: 'Sent with the join link after buying a webinar ticket' },
  { tag: 'membership-renewal', name: 'Membership renewal reminder', description: 'Sent before a membership expires' },
] as const;

export interface Communications {
  /** Name recipients see on emails from this academy (blank = academy name). */
  senderName: string;
  /** Replies to academy emails go here (blank = no Reply-To). */
  replyTo: string;
  /** Get an email for every successful purchase. */
  purchaseAlertEmails: string[];
  /** tag → false when switched off. */
  emails: Record<string, boolean>;
}

export interface UserExperience {
  /** Learners must verify their email before opening course content. */
  requireEmailVerification: boolean;
  /** Email admins when a learner posts a review. */
  reviewNotifications: boolean;
  /** Show a cookie notice on the academy website. */
  cookieBanner: boolean;
  /** Where a logged-out visitor is sent when they need an account. */
  defaultForm: 'login' | 'signup';
}

export interface SignupLogin {
  /** Offer "Continue with Google" on the academy's sign-in and sign-up pages. */
  googleEnabled: boolean;
  /** Learner passwords need 8+ characters with an uppercase, a lowercase letter and a number. */
  securePasswordPolicy: boolean;
}

export interface Preferences { communications: Communications; experience: UserExperience; signup: SignupLogin }
export type PreferenceSection = keyof Preferences;
export const PREFERENCE_SECTIONS: PreferenceSection[] = ['communications', 'experience', 'signup'];

export const DEFAULT_PREFERENCES: Preferences = {
  communications: { senderName: '', replyTo: '', purchaseAlertEmails: [], emails: {} },
  experience: { requireEmailVerification: false, reviewNotifications: true, cookieBanner: false, defaultForm: 'signup' },
  signup: { googleEnabled: true, securePasswordPolicy: false },
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CACHE_TTL = 60;

/** Academy preferences for communications, user experience and signup (tenant settings, cached briefly). */
@Injectable()
export class AcademyPreferencesService {
  constructor(private readonly prisma: PrismaService, @Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private cacheKey(tenantId: string, section: PreferenceSection) {
    return `academy-prefs:${section}:${tenantId}`;
  }

  async get<S extends PreferenceSection>(tenantId: string, section: S): Promise<Preferences[S]> {
    const cached = await this.redis.get(this.cacheKey(tenantId, section)).catch(() => null);
    if (cached) return JSON.parse(cached) as Preferences[S];
    const row = await this.prisma.tenantSetting.findUnique({ where: { tenantId_key: { tenantId, key: `prefs.${section}` } } });
    const merged = { ...DEFAULT_PREFERENCES[section], ...((row?.value ?? {}) as object) } as Preferences[S];
    await this.redis.set(this.cacheKey(tenantId, section), JSON.stringify(merged), 'EX', CACHE_TTL).catch(() => undefined);
    return merged;
  }

  async save<S extends PreferenceSection>(tenantId: string, section: S, input: Partial<Preferences[S]>): Promise<Preferences[S]> {
    const cur = await this.get(tenantId, section);
    const patch = Object.fromEntries(Object.entries(input ?? {}).filter(([k, v]) => v !== undefined && k in DEFAULT_PREFERENCES[section]));
    const next = { ...cur, ...patch } as Preferences[S];
    const errors = validate(section, next as unknown as Record<string, unknown>);
    if (errors.length) throw AppException.validation(errors);
    await this.prisma.tenantSetting.upsert({
      where: { tenantId_key: { tenantId, key: `prefs.${section}` } },
      create: { tenantId, key: `prefs.${section}`, value: next as never },
      update: { value: next as never },
    });
    await this.redis.del(this.cacheKey(tenantId, section)).catch(() => undefined);
    return next;
  }

  /** Rejects a learner password that breaks the academy's secure password policy (when it is on). */
  async assertPasswordAllowed(tenantId: string | null | undefined, password: string, field = 'password') {
    if (!tenantId) return;
    if ((await this.get(tenantId, 'signup')).securePasswordPolicy && !SECURE_PASSWORD.test(password)) {
      throw AppException.validation([{ field, message: 'Use at least 8 characters with an uppercase letter, a lowercase letter and a number' }]);
    }
  }

  /** False when the academy switched this learner email off. */
  async emailEnabled(tenantId: string, tag: string): Promise<boolean> {
    if (!TOGGLEABLE_EMAILS.some((e) => e.tag === tag)) return true;
    return (await this.get(tenantId, 'communications')).emails[tag] !== false;
  }
}

function validate(section: PreferenceSection, v: Record<string, unknown>) {
  const errors: { field: string; message: string }[] = [];
  const str = (k: string, max: number) => { if (typeof v[k] !== 'string' || (v[k] as string).length > max) errors.push({ field: k, message: `Up to ${max} characters` }); };
  const bool = (k: string) => { if (typeof v[k] !== 'boolean') errors.push({ field: k, message: 'Must be on or off' }); };
  const email = (k: string) => { if (v[k] && !EMAIL.test(v[k] as string)) errors.push({ field: k, message: 'Enter a valid email address' }); };
  if (section === 'communications') {
    str('senderName', 80); str('replyTo', 191); email('replyTo');
    const list = v.purchaseAlertEmails;
    if (!Array.isArray(list) || list.length > 5 || list.some((e) => typeof e !== 'string' || !EMAIL.test(e))) errors.push({ field: 'purchaseAlertEmails', message: 'Up to 5 valid email addresses' });
    const emails = v.emails as Record<string, unknown>;
    if (!emails || typeof emails !== 'object' || Object.entries(emails).some(([k, x]) => !TOGGLEABLE_EMAILS.some((e) => e.tag === k) || typeof x !== 'boolean')) errors.push({ field: 'emails', message: 'Unknown email type' });
  } else if (section === 'experience') {
    bool('requireEmailVerification'); bool('reviewNotifications'); bool('cookieBanner');
    if (v.defaultForm !== 'login' && v.defaultForm !== 'signup') errors.push({ field: 'defaultForm', message: 'Choose log in or sign up' });
  } else {
    bool('googleEnabled'); bool('securePasswordPolicy');
  }
  return errors;
}

/** Strong-password rule used when an academy turns on the secure password policy. */
export const SECURE_PASSWORD = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

@Global()
@Module({ providers: [AcademyPreferencesService], exports: [AcademyPreferencesService] })
export class AcademyPreferencesModule {}
