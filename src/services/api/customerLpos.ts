import type { CustomerLpoCreateDto, CustomerLpoDto, CustomerLpoUpdateDto } from '../../../shared/dto/index';
import { collectionApi } from './resource';

export interface CustomerLpoFilters { quotationId?: string; hireAgreementId?: string; customerId?: string; q?: string }

/** `/api/v1/customer-lpos` (no delete endpoint). The LPO number is the customer's own text. */
export const customerLposApi = collectionApi<CustomerLpoDto, CustomerLpoCreateDto, CustomerLpoUpdateDto, CustomerLpoFilters>('/customer-lpos');
