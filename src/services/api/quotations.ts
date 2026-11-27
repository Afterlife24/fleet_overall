import type {
  PhaseHistoryDto, QuotationCreateDto, QuotationDto, QuotationPhase, QuotationPhaseChangeDto, QuotationUpdateDto,
} from '../../../shared/dto/index';
import { apiRequest, type ApiRequestOptions } from './http';
import { collectionApi } from './resource';

export interface QuotationFilters {
  phase?: QuotationPhase; customerId?: string; branchId?: string; salesUserId?: string; number?: string; q?: string;
}

/** `/api/v1/quotations` (no delete endpoint; a quotation is closed through its phase). */
export const quotationsApi = {
  ...collectionApi<QuotationDto, QuotationCreateDto, QuotationUpdateDto, QuotationFilters>('/quotations'),
  history: (id: string, opts: Pick<ApiRequestOptions, 'signal'> = {}) =>
    apiRequest<{ items: PhaseHistoryDto[] }>(`/quotations/${encodeURIComponent(id)}/history`, opts),
  /** Phase change; needs `If-Match` and an Idempotency-Key. LOST and reopen require a reason. */
  changePhase: (id: string, rowVersion: number, input: QuotationPhaseChangeDto, submissionId: string, opts: Pick<ApiRequestOptions, 'signal'> = {}) =>
    apiRequest<QuotationDto>(`/quotations/${encodeURIComponent(id)}/phase`, {
      method: 'POST', body: input, rowVersion, submissionId, ...opts,
    }),
};
