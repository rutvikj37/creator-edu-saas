/**
 * Plan feature keys. Plans store values for these keys in `PlanFeature`;
 * nothing in code hardcodes which plan has which feature.
 * kind: 'flag' (enabled true/false) or 'limit' (numeric, null = unlimited).
 */
export const FEATURES = Object.freeze({
  COURSES_MAX: { key: 'courses.max', kind: 'limit', label: 'Courses' },
  STUDENTS_MAX: { key: 'students.max', kind: 'limit', label: 'Students' },
  STAFF_MAX: { key: 'staff.max', kind: 'limit', label: 'Staff accounts' },
  STORAGE_GB: { key: 'storage.gb', kind: 'limit', label: 'Storage (GB)' },
  BANDWIDTH_GB: { key: 'bandwidth.gb', kind: 'limit', label: 'Video bandwidth (GB / month)' },
  CUSTOM_DOMAINS: { key: 'domains.custom', kind: 'limit', label: 'Custom domains' },
  WEBSITE_BUILDER: { key: 'website_builder', kind: 'flag', label: 'Website builder' },
  MARKETING: { key: 'marketing', kind: 'flag', label: 'Marketing tools' },
  AFFILIATES: { key: 'affiliates', kind: 'flag', label: 'Affiliate program' },
  LIVE_CLASSES: { key: 'live_classes', kind: 'flag', label: 'Live classes' },
  ANALYTICS_ADVANCED: { key: 'analytics.advanced', kind: 'flag', label: 'Advanced analytics' },
  AI_CREDITS: { key: 'ai.credits', kind: 'limit', label: 'AI credits / month' },
  WHITE_LABEL: { key: 'white_label', kind: 'flag', label: 'White-label' },
  COMMISSION_PERCENT: { key: 'commission.percent', kind: 'limit', label: 'Transaction commission %' },
});

export const FEATURE_KEYS = Object.freeze(Object.values(FEATURES).map((f) => f.key));
