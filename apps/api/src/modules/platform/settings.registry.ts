import { z } from 'zod';

/**
 * Every platform setting that may be edited, with its validation. Unknown keys are rejected,
 * secret values are encrypted at rest and returned masked.
 */
export interface SettingDef {
  key: string;
  group: string;
  label: string;
  schema: z.ZodType;
  secret?: boolean;
  public?: boolean;
}

const str = (max = 200) => z.string().trim().max(max);
const optUrl = z.union([z.literal(''), z.url().max(500)]);

export const SETTINGS: SettingDef[] = [
  { group: 'branding', key: 'branding.name', label: 'Platform name', schema: str(80).min(2), public: true },
  { group: 'branding', key: 'branding.tagline', label: 'Tagline', schema: str(160), public: true },
  { group: 'branding', key: 'branding.logoUrl', label: 'Logo URL', schema: optUrl, public: true },
  { group: 'branding', key: 'branding.faviconUrl', label: 'Favicon URL', schema: optUrl, public: true },
  { group: 'general', key: 'general.defaultCurrency', label: 'Default currency', schema: z.string().regex(/^[A-Z]{3}$/) },
  { group: 'general', key: 'general.defaultTimezone', label: 'Default time zone', schema: str(64).refine((tz) => Intl.supportedValuesOf('timeZone').includes(tz) || tz === 'UTC', 'Unknown time zone') },
  { group: 'general', key: 'general.defaultLocale', label: 'Default language', schema: z.enum(['en', 'hi', 'gu']) },
  { group: 'registration', key: 'registration.creatorSignupEnabled', label: 'Allow creator sign-ups', schema: z.boolean() },
  { group: 'registration', key: 'registration.requireEmailVerification', label: 'Require verified email before publishing', schema: z.boolean() },
  { group: 'email', key: 'email.fromName', label: 'Sender name', schema: str(80) },
  { group: 'email', key: 'email.fromAddress', label: 'Sender address', schema: z.union([z.literal(''), z.email()]) },
  { group: 'email', key: 'email.replyTo', label: 'Reply-to address', schema: z.union([z.literal(''), z.email()]) },
  { group: 'sms', key: 'sms.senderId', label: 'SMS sender ID', schema: str(11) },
  { group: 'whatsapp', key: 'whatsapp.businessNumber', label: 'WhatsApp business number', schema: z.union([z.literal(''), z.string().regex(/^\+[1-9]\d{7,14}$/)]) },
  { group: 'payments', key: 'payments.platformCommissionNote', label: 'Commission note shown to creators', schema: str(300) },
  { group: 'tax', key: 'tax.gstin', label: 'Platform GSTIN', schema: z.union([z.literal(''), z.string().regex(/^[0-9]{2}[A-Z0-9]{13}$/, 'Invalid GSTIN')]) },
  { group: 'tax', key: 'tax.defaultGstRate', label: 'Default GST rate (%)', schema: z.number().min(0).max(28) },
  { group: 'legal', key: 'legal.termsUrl', label: 'Terms & conditions URL', schema: optUrl, public: true },
  { group: 'legal', key: 'legal.privacyUrl', label: 'Privacy policy URL', schema: optUrl, public: true },
  { group: 'legal', key: 'legal.refundUrl', label: 'Refund policy URL', schema: optUrl, public: true },
  { group: 'system', key: 'system.maintenanceMode', label: 'Maintenance mode', schema: z.boolean() },
  { group: 'system', key: 'system.maintenanceMessage', label: 'Maintenance message', schema: str(300) },
  { group: 'system', key: 'system.supportEmail', label: 'Support email', schema: z.union([z.literal(''), z.email()]), public: true },
];

export const SETTINGS_BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));
export const SETTING_GROUPS = [...new Set(SETTINGS.map((s) => s.group))];
