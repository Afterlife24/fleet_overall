import type {
  AgreementStatusValue, HireAgreementCreateDto, HireAgreementDto, HireAgreementUpdateDto,
} from '../../../shared/dto/index';
import { apiRequest, type ApiRequestOptions } from './http';
import { collectionApi } from './resource';

export interface HireAgreementFilters { quotationId?: string; customerId?: string; status?: AgreementStatusValue; q?: string }

/** `/api/v1/hire-agreements`. Totals and snapshots are computed by the server and ignored if sent. */
export const hireAgreementsApi = {
  ...collectionApi<HireAgreementDto, HireAgreementCreateDto, HireAgreementUpdateDto, HireAgreementFilters>('/hire-agreements'),
  markSent: (id: string, rowVersion: number, opts: Pick<ApiRequestOptions, 'signal'> = {}) =>
    apiRequest<HireAgreementDto>(`/hire-agreements/${encodeURIComponent(id)}/sent`, { method: 'POST', body: {}, rowVersion, ...opts }),
  markReceived: (id: string, rowVersion: number, reason: string, opts: Pick<ApiRequestOptions, 'signal'> = {}) =>
    apiRequest<HireAgreementDto>(`/hire-agreements/${encodeURIComponent(id)}/received`, { method: 'POST', body: { reason }, rowVersion, ...opts }),
};
