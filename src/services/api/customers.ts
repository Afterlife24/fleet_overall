import type { CustomerCreateDto, CustomerDto, CustomerStatus, CustomerUpdateDto } from '../../../shared/dto/index';
import { archiveCall, collectionApi } from './resource';

export interface CustomerFilters { status?: CustomerStatus; branchId?: string; q?: string }

/** `/api/v1/customers`. `archive` sets the customer INACTIVE (no hard delete). */
export const customersApi = {
  ...collectionApi<CustomerDto, CustomerCreateDto, CustomerUpdateDto, CustomerFilters>('/customers'),
  archive: archiveCall<CustomerDto>('/customers'),
};
