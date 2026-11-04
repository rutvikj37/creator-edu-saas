export declare const ERROR_CODES: Readonly<Record<string, string>>;
export declare const PLATFORM_ROLES: Readonly<Record<string, string>>;
export declare const TENANT_ROLES: Readonly<Record<string, string>>;
export declare const REALMS: Readonly<{ PLATFORM: 'PLATFORM'; TENANT: 'TENANT' }>;
export interface FeatureDef { key: string; kind: 'flag' | 'limit'; label: string }
export declare const FEATURES: Readonly<Record<string, FeatureDef>>;
export declare const FEATURE_KEYS: readonly string[];
export declare const ORDER_STATUS: Readonly<Record<string, string>>;
export declare const TENANT_STATUS: Readonly<Record<string, string>>;
export declare const SUPPORTED_LOCALES: readonly string[];
