// Customer contracts (Requirement 10). Money is a decimal string.
export const CUSTOMER_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'BLACKLISTED'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

/** `GET /api/v1/customers/:id`. Send `rowVersion` back as `If-Match` on `PATCH` and `DELETE` (archive). */
export interface CustomerDto {
  id: string;
  customerCode: string;
  fleetLogCode: string | null;
  name: string;
  taxRegistrationNo: string | null;
  attn: string | null;
  email: string | null;
  phone: string;
  address: string;
  billingAddress: string | null;
  creditLimit: string;
  creditHold: boolean;
  status: CustomerStatus;
  branchId: string | null;
  aniRavaliActive: boolean;
  crmHaReference: string | null;
  notes: string | null;
  customAttributes: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

/** `POST /api/v1/customers` (requires `Idempotency-Key`). `customerCode` is allocated when omitted. */
export interface CustomerCreateDto {
  customerCode?: string;
  fleetLogCode?: string | null;
  name: string;
  taxRegistrationNo?: string | null;
  attn?: string | null;
  email?: string | null;
  phone: string;
  address: string;
  billingAddress?: string | null;
  creditLimit?: string | number;
  creditHold?: boolean;
  status?: CustomerStatus;
  branchId?: string | null;
  aniRavaliActive?: boolean;
  crmHaReference?: string | null;
  notes?: string | null;
  customAttributes?: Record<string, unknown>;
}

/** `PATCH /api/v1/customers/:id` (requires `If-Match`). `customerCode` is immutable. */
export type CustomerUpdateDto = Partial<Omit<CustomerCreateDto, 'creditLimit'> & { creditLimit: string | number }>;
