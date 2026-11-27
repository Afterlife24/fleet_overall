import type { PageDto } from '../../../shared/dto/index';
import { apiRequest, type ApiRequestOptions } from './http';

export type Filters = object;

/** Paging and sorting accepted by every list endpoint (`sort=field` or `sort=-field`). */
export interface ListParams {
  page?: number;
  pageSize?: number;
  sort?: string;
}

type Opts = Pick<ApiRequestOptions, 'signal'>;

/** List, get, create, update and archive calls for one collection under `/api/v1`. */
export function collectionApi<T, Create, Update, F extends Filters = Filters>(base: string) {
  return {
    list: (params: ListParams & F = {} as ListParams & F, opts: Opts = {}) =>
      apiRequest<PageDto<T>>(base, { query: params, ...opts }),
    get: (id: string, opts: Opts = {}) => apiRequest<T>(`${base}/${encodeURIComponent(id)}`, opts),
    /** `submissionId` fixes the Idempotency-Key: reuse the same id when retrying one submission. */
    create: (body: Create, submissionId: string, opts: Opts = {}) =>
      apiRequest<T>(base, { method: 'POST', body, submissionId, ...opts }),
    update: (id: string, rowVersion: number, patch: Update, opts: Opts = {}) =>
      apiRequest<T>(`${base}/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch, rowVersion, ...opts }),
  };
}

/** `DELETE base/:id` with `If-Match`: archive or deactivate (the server never hard-deletes these records). */
export function archiveCall<T>(base: string) {
  return (id: string, rowVersion: number, opts: Opts = {}) =>
    apiRequest<T>(`${base}/${encodeURIComponent(id)}`, { method: 'DELETE', rowVersion, ...opts });
}

