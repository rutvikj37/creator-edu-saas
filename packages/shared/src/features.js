/**
 * Plan feature keys. Plans store values for these keys in `PlanFeature`;
 * nothing in code hardcodes which plan has which feature.
 * kind: 'flag' (enabled true/false) or 'limit' (numeric, null = unlimited).
 */
export const FEATURES = Object.freeze({
  COURSES_MAX: { key: 'courses.max', kind: 'limit', label: 'Courses' },
  PRODUCTS_MAX: { key: 'products.max', kind: 'limit', label: 'Products' },
  STUDENTS_MAX: { key: 'students.max', kind: 'limit', label: 'Students' },
  CONTACTS_MAX: { key: 'contacts.max', kind: 'limit', label: 'Contacts' },
  STAFF_MAX: { key: 'staff.max', kind: 'limit', label: 'Admin accounts' },
  STORAGE_GB: { key: 'storage.gb', kind: 'limit', label: 'Storage (GB)' },
  BANDWIDTH_GB: { key: 'bandwidth.gb', kind: 'limit', label: 'Video bandwidth (GB / month)' },
  CUSTOM_DOMAINS: { key: 'domains.custom', kind: 'limit', label: 'Custom domains' },
  MARKETING_EMAILS: { key: 'marketing.emails', kind: 'limit', label: 'Marketing emails / month' },
  WEBSITE_BUILDER: { key: 'website_builder', kind: 'flag', label: 'Website builder' },
  MARKETING: { key: 'marketing', kind: 'flag', label: 'Marketing tools' },
  AFFILIATES: { key: 'affiliates', kind: 'flag', label: 'Affiliate program' },
  LIVE_CLASSES: { key: 'live_classes', kind: 'flag', label: 'Unlimited live classes & webinars' },
  INTEGRATIONS: { key: 'integrations', kind: 'flag', label: 'Third party integrations' },
  ANALYTICS_ADVANCED: { key: 'analytics.advanced', kind: 'flag', label: 'Advanced analytics' },
  AI_CREDITS: { key: 'ai.credits', kind: 'limit', label: 'AI credits / month' },
  WHITE_LABEL: { key: 'white_label', kind: 'flag', label: 'White-label' },
  COMMISSION_PERCENT: { key: 'commission.percent', kind: 'limit', label: 'Transaction commission %' },
});

export const FEATURE_KEYS = Object.freeze(Object.values(FEATURES).map((f) => f.key));
