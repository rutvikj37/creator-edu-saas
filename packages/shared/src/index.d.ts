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
export declare const PERMISSIONS: Readonly<Record<string, string>>;
export declare const ROLE_PERMISSIONS: Readonly<Record<string, readonly string[]>>;
export declare const MFA_REQUIRED_ROLES: readonly string[];
export declare function permissionScope(key: string): 'PLATFORM' | 'TENANT';

export interface CertificateDesign {
  key: string;
  name: string;
  description: string;
  suggestedAccent: string;
  suggestedTitle: string;
}
export declare const CERTIFICATE_DESIGNS: Readonly<Record<string, CertificateDesign>>;
export declare const CERTIFICATE_DESIGN_KEYS: readonly string[];
export declare function resolveCertificateDesign(key: string | null | undefined): CertificateDesign;
