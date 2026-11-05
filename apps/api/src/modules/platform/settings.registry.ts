import { z } from 'zod';
import { isValidTimeZone } from '../../common/time/timezone.js';

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
  { group: 'general', key: 'general.defaultTimezone', label: 'Default time zone', schema: str(64).refine((tz) => isValidTimeZone(tz), 'Unknown time zone') },
  { group: 'general', key: 'general.defaultLocale', label: 'Default language', schema: z.enum(['en', 'hi', 'gu']) },
  { group: 'registration', key: 'registration.creatorSignupEnabled', label: 'Allow creator sign-ups', schema: z.boolean() },
  { group: 'registration', key: 'registration.requireEmailVerification', label: 'Require verified email before publishing', schema: z.boolean() },
  { group: 'email', key: 'email.fromName', label: 'Sender name', schema: str(80) },
  { group: 'email', key: 'email.fromAddress', label: 'Sender address', schema: z.union([z.literal(''), z.email()]) },
  { group: 'email', key: 'email.replyTo', label: 'Reply-to address', schema: z.union([z.literal(''), z.email()]) },
  { group: 'sms', key: 'sms.senderId', label: 'SMS sender ID', schema: str(11) },
  { group: 'whatsapp', key: 'whatsapp.businessNumber', label: 'WhatsApp business number', schema: z.union([z.literal(''), z.string().regex(/^\+[1-9]\d{7,14}$/)]) },
  { group: 'payments', key: 'payments.platformCommissionNote', label: 'Commission note shown to creators', schema: str(300) },
  { group: 'payments', key: 'payments.razorpayKeyId', label: 'Platform Razorpay key id (plan billing)', schema: z.union([z.literal(''), z.string().trim().regex(/^rzp_(test|live)_[A-Za-z0-9]{8,32}$/, 'Starts with rzp_test_ or rzp_live_')]) },
  { group: 'payments', key: 'payments.razorpayKeySecret', label: 'Platform Razorpay key secret', schema: str(128), secret: true },
  { group: 'payments', key: 'payments.razorpayWebhookSecret', label: 'Platform Razorpay webhook secret', schema: str(128), secret: true },
  { group: 'billing', key: 'billing.legalName', label: 'Legal name on plan invoices', schema: str(200) },
  { group: 'billing', key: 'billing.address', label: 'Address on plan invoices', schema: str(300) },
  { group: 'billing', key: 'billing.graceDays', label: 'Grace period after an unpaid renewal (days)', schema: z.number().int().min(0).max(30) },
  { group: 'billing', key: 'billing.minCommissionInvoice', label: 'Minimum commission to invoice (INR)', schema: z.number().min(0).max(100000) },
  { group: 'tax', key: 'tax.gstin', label: 'Platform GSTIN', schema: z.union([z.literal(''), z.string().regex(/^[0-9]{2}[A-Z0-9]{13}$/, 'Invalid GSTIN')]) },
  { group: 'tax', key: 'tax.defaultGstRate', label: 'Default GST rate (%)', schema: z.number().min(0).max(28) },
  { group: 'legal', key: 'legal.termsUrl', label: 'Terms & conditions URL', schema: optUrl, public: true },
  { group: 'legal', key: 'legal.privacyUrl', label: 'Privacy policy URL', schema: optUrl, public: true },
  { group: 'legal', key: 'legal.refundUrl', label: 'Refund policy URL', schema: optUrl, public: true },
  // Video costs are estimates shown to administrators only; nothing is charged automatically.
  { group: 'video', key: 'video.storageRatePerGbMonth', label: 'Provider storage rate per GB per month (in rate currency)', schema: z.number().min(0).max(1000) },
  { group: 'video', key: 'video.deliveryRatePerGb', label: 'Provider delivery rate per GB (in rate currency)', schema: z.number().min(0).max(1000) },
  { group: 'video', key: 'video.rateCurrency', label: 'Currency of provider rates', schema: z.string().regex(/^[A-Z]{3}$/) },
  { group: 'video', key: 'video.displayCurrency', label: 'Currency for cost estimates', schema: z.string().regex(/^[A-Z]{3}$/) },
  { group: 'video', key: 'video.exchangeRate', label: 'Exchange rate: 1 rate-currency unit in display currency', schema: z.number().positive().max(100000) },
  { group: 'video', key: 'video.fairUseStorageGb', label: 'Fair-use video storage per academy (GB, 0 = none)', schema: z.number().min(0).max(1_000_000) },
  { group: 'video', key: 'video.fairUseDeliveryGbMonth', label: 'Fair-use video delivery per academy per month (GB, 0 = none)', schema: z.number().min(0).max(10_000_000) },
  { group: 'backups', key: 'backups.driveLowSpacePercent', label: 'Warn when Google Drive free space is below (%)', schema: z.number().min(1).max(90) },
  { group: 'system', key: 'system.maintenanceMode', label: 'Maintenance mode', schema: z.boolean() },
  { group: 'system', key: 'system.maintenanceMessage', label: 'Maintenance message', schema: str(300) },
  { group: 'system', key: 'system.supportEmail', label: 'Support email', schema: z.union([z.literal(''), z.email()]), public: true },
];

export const SETTINGS_BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));
export const SETTING_GROUPS = [...new Set(SETTINGS.map((s) => s.group))];
