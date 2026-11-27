import type {
  BranchDto, CompanyDto, CompanyPatch, CustomFieldDto, CustomFieldType, OrgAppDto, RoleDto, UserDto, UserStatus,
} from '../../../shared/dto/index';
import { apiRequest, type ApiRequestOptions } from './http';
import { archiveCall, collectionApi } from './resource';

type Opts = Pick<ApiRequestOptions, 'signal'>;

/** `GET/PATCH /api/v1/company`. */
export const companyApi = {
  get: (opts: Opts = {}) => apiRequest<CompanyDto>('/company', opts),
  update: (rowVersion: number, patch: CompanyPatch, opts: Opts = {}) =>
    apiRequest<CompanyDto>('/company', { method: 'PATCH', body: patch, rowVersion, ...opts }),
};

export interface BranchCreate {
  code: string; name: string; countryCode: string; city: string; address: string;
  phone?: string | null; managerUserId?: string | null; timezone: string;
}
export type BranchUpdate = Partial<BranchCreate> & { active?: boolean };
/** `/api/v1/branches`. `archive` deactivates the branch. */
export const branchesApi = {
  ...collectionApi<BranchDto, BranchCreate, BranchUpdate, { active?: boolean; q?: string }>('/branches'),
  archive: archiveCall<BranchDto>('/branches'),
};

export interface RolesResponse { items: RoleDto[]; permissionCodes: string[]; appCodes: string[] }
/** `GET /api/v1/roles` (read only). */
export const rolesApi = {
  list: (opts: Opts = {}) => apiRequest<RolesResponse>('/roles', opts),
};

export interface UserCreate {
  email: string; displayName: string; phone?: string | null; roleId: string;
  branchId?: string | null; allBranches?: boolean; authSubject?: string;
}
export type UserUpdate = Partial<Pick<UserCreate, 'displayName' | 'phone' | 'roleId' | 'allBranches'>> & { branchId?: string | null };
/** `/api/v1/users`. */
export const usersApi = {
  ...collectionApi<UserDto, UserCreate, UserUpdate, { status?: UserStatus; branchId?: string; roleId?: string; q?: string }>('/users'),
  setStatus: (id: string, rowVersion: number, status: UserStatus, reason?: string, opts: Opts = {}) =>
    apiRequest<UserDto>(`/users/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: { status, reason }, rowVersion, ...opts }),
};

export type OrgAppPatch = { active?: boolean; onboarded?: boolean };
/** `/api/v1/apps`. `rowVersion` is null until the app is first changed; the first PATCH then sends no `If-Match`. */
export const appsApi = {
  list: (opts: Opts = {}) => apiRequest<{ items: OrgAppDto[] }>('/apps', opts),
  update: (appCode: string, rowVersion: number | null, patch: OrgAppPatch, opts: Opts = {}) =>
    apiRequest<OrgAppDto & { alsoActivated: string[] }>(`/apps/${encodeURIComponent(appCode)}`, {
      method: 'PATCH', body: patch, ...(rowVersion === null ? {} : { rowVersion }), ...opts,
    }),
};

export interface CustomFieldCreate {
  appCode: string; entityType: string; fieldKey: string; label: string; fieldType: CustomFieldType;
  required?: boolean; options?: string[]; displayOrder?: number; inTable?: boolean; filterable?: boolean;
}
export type CustomFieldUpdate = Partial<Omit<CustomFieldCreate, 'appCode' | 'entityType' | 'fieldKey'>> & { active?: boolean };
export interface CustomFieldFilters { appCode?: string; entityType?: string; active?: boolean }
const customFieldsBase = collectionApi<CustomFieldDto, CustomFieldCreate, CustomFieldUpdate>('/custom-fields');
/** `/api/v1/custom-fields`. The list is not paged: it returns `{ items, fieldTypes }`. */
export const customFieldsApi = {
  list: (filters: CustomFieldFilters = {}, opts: Opts = {}) =>
    apiRequest<{ items: CustomFieldDto[]; fieldTypes: CustomFieldType[] }>('/custom-fields', { query: filters, ...opts }),
  get: customFieldsBase.get,
  create: customFieldsBase.create,
  update: customFieldsBase.update,
  archive: archiveCall<CustomFieldDto>('/custom-fields'),
};
