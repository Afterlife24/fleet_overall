// Company area contracts (Requirement 9): company profile, branches, roles, users, apps, custom fields.

export const GATING_RULE_KEYS = [
  'requireQuote',
  'requireHaSent',
  'requireHaReceived',
  'requireLpo',
  'blockCreditHold',
  'requireTpcValid',
  'warnOverdueInspection',
] as const;
export type GatingRuleKey = (typeof GATING_RULE_KEYS)[number];
export type GatingRules = Record<GatingRuleKey, boolean>;

export const CUSTOM_FIELD_TYPES = ['TEXT', 'NUMBER', 'CURRENCY', 'DATE', 'SELECT', 'BOOLEAN'] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export const USER_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** `GET /api/v1/company`. Send `rowVersion` back as `If-Match` on `PATCH /api/v1/company`. */
export interface CompanyDto {
  id: string;
  code: string;
  name: string;
  tradeLicense: string | null;
  taxRegistrationNo: string | null;
  address: string;
  phone: string | null;
  email: string | null;
  timezone: string;
  currencyCode: string;
  vatRate: number;
  status: string;
  gatingRules: GatingRules;
  updatedAt: string;
  rowVersion: number;
}

export type CompanyPatch = Partial<
  Pick<CompanyDto, 'name' | 'tradeLicense' | 'taxRegistrationNo' | 'address' | 'phone' | 'email' | 'timezone' | 'currencyCode' | 'vatRate'>
> & { gatingRules?: GatingRules };

export interface BranchDto {
  id: string;
  code: string;
  name: string;
  countryCode: string;
  city: string;
  address: string;
  phone: string | null;
  managerUserId: string | null;
  timezone: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

export interface RoleDto {
  id: string;
  code: string;
  name: string;
  permissions: string[];
  appCodes: string[];
  active: boolean;
  rowVersion: number;
}

export interface UserDto {
  id: string;
  email: string;
  displayName: string;
  phone: string | null;
  roleId: string;
  roleCode: string;
  branchId: string | null;
  allBranches: boolean;
  isOwner: boolean;
  status: UserStatus;
  avatarColor: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

export interface OrgAppDto {
  appCode: string;
  name: string;
  category: string;
  depends: string[];
  active: boolean;
  onboarded: boolean;
  rowVersion: number | null;
}

export interface CustomFieldDto {
  id: string;
  appCode: string;
  entityType: string;
  fieldKey: string;
  label: string;
  fieldType: CustomFieldType;
  required: boolean;
  options: string[];
  displayOrder: number;
  systemField: boolean;
  inTable: boolean;
  filterable: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

export interface PageDto<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
