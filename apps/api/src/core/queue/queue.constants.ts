/** Every BullMQ queue in the system. See docs/SYSTEM_ARCHITECTURE.md §6. */
export const QUEUES = {
  MAINTENANCE: 'maintenance',
  NOTIFICATIONS: 'notifications',
  MESSAGING: 'messaging',
  VIDEO: 'video',
  WEBHOOKS_IN: 'webhooks-in',
  COMMERCE: 'commerce',
  BILLING: 'billing',
  CERTIFICATES: 'certificates',
  MARKETING: 'marketing',
  LIVE: 'live',
  ANALYTICS: 'analytics',
  AI: 'ai',
  BACKUPS: 'backups',
  DOMAINS: 'domains',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const MAINTENANCE_JOBS = {
  PURGE_EXPIRED_IDEMPOTENCY_KEYS: 'purge-expired-idempotency-keys',
  PUBLISH_SCHEDULED_COURSES: 'publish-scheduled-courses',
} as const;
