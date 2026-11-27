// Read adapters for the retained browser screens (planner, invoices, transport, collection, gate, inspections).
// Those screens read customers, machines, quotations and agreements through synchronous helpers
// (`customerLinks.ts`, `quotationInvoicing.ts`, `collectionDocs.ts`) and through `customerService` /
// `machineService`. The API stays the authority: these helpers fetch from it and hand the retained code the
// shapes it already expects. The two `mirror*` functions fill in-memory, non-persisted copies that the
// synchronous helpers read; they hold no data of their own and are replaced on every refresh.
import type { PageDto } from '../../../shared/dto/index';
import { useAuthStore, JA_ORG_ID } from '@/store/authStore';
import { useCrmStore } from '@/store/crmStore';
import { useHireAgreementStore } from '@/store/hireAgreementStore';
import type { Customer } from '@/types/customer';
import type { CustomerRecord } from '@/types/customerani';
import type { HireAgreement } from '@/types/hireagreement';
import type { Machine } from '@/types/machine';
import type { Quotation } from '@/types/quotation';
import { branchesApi } from './company';
import { customersApi } from './customers';
import { hireAgreementsApi } from './hireAgreements';
import { ApiClientError } from './http';
import { machineModelsApi } from './machineModels';
import { machinesApi } from './machines';
import {
  agreementFromDto, customerFromDto, customerRecordFromDto, machineFromDto, quotationFromDto,
} from './mappers';
import { quotationsApi } from './quotations';
import { ensureSession, useSessionStore } from './session';
import { invoicesApi } from './invoices';
import { invoiceFromDto } from './invoiceMappers';
import { useTaxInvoiceStore } from '@/store/taxInvoiceStore';
import type { TaxInvoice } from '@/types/taxinvoice';

const PAGE_SIZE = 100;
const MAX_PAGES = 50;

/** Reads every page of a list endpoint. */
export async function listAll<T>(fetchPage: (page: number, pageSize: number) => Promise<PageDto<T>>): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetchPage(page, PAGE_SIZE);
    out.push(...res.items);
    if (out.length >= res.total || res.items.length === 0) break;
  }
  return out;
}

/** Waits for the API session. Retained screens may ask for data before the layout has finished signing in. */
async function requireSession(): Promise<void> {
  if (await ensureSession()) return;
  throw new ApiClientError({
    code: 'UNAUTHENTICATED',
    message: useSessionStore.getState().error ?? 'There is no API session.',
    status: 401,
  });
}

/** The browser's organization key (retained screens filter by it). */
export function browserOrgId(): string {
  return useAuthStore.getState().user?.orgId ?? JA_ORG_ID;
}

export async function loadBranchNames(): Promise<Map<string, string>> {
  const branches = await listAll((page, pageSize) => branchesApi.list({ page, pageSize }));
  return new Map(branches.map((b) => [b.id, b.name]));
}

export async function loadCustomerRecords(orgId = browserOrgId()): Promise<CustomerRecord[]> {
  await requireSession();
  const [customers, branchNames] = await Promise.all([
    listAll((page, pageSize) => customersApi.list({ page, pageSize })),
    loadBranchNames().catch(() => new Map<string, string>()),
  ]);
  return customers.map((c) => customerRecordFromDto(c, orgId, branchNames));
}

export async function loadCustomers(): Promise<Customer[]> {
  await requireSession();
  const customers = await listAll((page, pageSize) => customersApi.list({ page, pageSize }));
  return customers.map(customerFromDto);
}

export async function loadMachines(): Promise<Machine[]> {
  await requireSession();
  const [machines, models, branchNames] = await Promise.all([
    listAll((page, pageSize) => machinesApi.list({ page, pageSize })),
    listAll((page, pageSize) => machineModelsApi.list({ page, pageSize })),
    loadBranchNames().catch(() => new Map<string, string>()),
  ]);
  const byModel = new Map(models.map((m) => [m.id, m]));
  return machines.map((m) => machineFromDto(m, byModel.get(m.modelId), branchNames.get(m.branchId) ?? ''));
}

export async function loadMachine(id: string): Promise<Machine | undefined> {
  await requireSession();
  let dto;
  try {
    dto = await machinesApi.get(id);
  } catch (err) {
    if (err instanceof ApiClientError && err.status === 404) return undefined;
    throw err;
  }
  const [model, branchNames] = await Promise.all([
    machineModelsApi.get(dto.modelId).catch(() => undefined),
    loadBranchNames().catch(() => new Map<string, string>()),
  ]);
  return machineFromDto(dto, model, branchNames.get(dto.branchId) ?? '');
}

export interface CrmSnapshot {
  quotations: Quotation[];
  agreements: HireAgreement[];
  /** quotation id -> customer uuid (the browser shapes carry the business code instead) */
  quotationCustomerIds: ReadonlyMap<string, string>;
}

export async function loadQuotationsAndAgreements(orgId = browserOrgId()): Promise<CrmSnapshot> {
  const [quotations, agreements, customers] = await Promise.all([
    listAll((page, pageSize) => quotationsApi.list({ page, pageSize })),
    listAll((page, pageSize) => hireAgreementsApi.list({ page, pageSize })),
    listAll((page, pageSize) => customersApi.list({ page, pageSize })),
  ]);
  const byId = new Map(customers.map((c) => [c.id, { code: c.customerCode, name: c.name }]));
  const live = agreements.filter((a) => a.status !== 'Cancelled');
  const agreementNoByQuotation = new Map(live.map((a) => [a.quotationId, a.agreementNo]));
  return {
    quotations: quotations.map((q) => quotationFromDto(q, { orgId, customers: byId, agreementNoByQuotation })),
    agreements: agreements.map((a) => agreementFromDto(a, { orgId, customers: byId })),
    quotationCustomerIds: new Map(quotations.map((q) => [q.id, q.customerId])),
  };
}

/** Replaces the in-memory copies that the synchronous retained helpers read. Never persisted. */
export function mirrorRetainedData(data: { quotations: Quotation[]; agreements: HireAgreement[] }): void {
  useCrmStore.setState({ quotations: data.quotations });
  useHireAgreementStore.setState({ agreements: data.agreements });
}

/** Fetches and mirrors in one step (used outside React). */
export async function refreshRetainedMirrors(orgId = browserOrgId()): Promise<void> {
  mirrorRetainedData(await loadQuotationsAndAgreements(orgId));
}

// ── Invoices (read mirror for customer links, collection references and the CRM quotation panel) ──

export async function loadInvoices(orgId = browserOrgId()): Promise<TaxInvoice[]> {
  await requireSession();
  const invoices = await listAll((page, pageSize) => invoicesApi.list({ page, pageSize }));
  return invoices.map((i) => invoiceFromDto(i, orgId));
}

/** Replaces the in-memory invoice copy read by the retained screens. Never persisted. */
export function mirrorInvoices(invoices: TaxInvoice[]): void {
  useTaxInvoiceStore.setState({ invoices });
}
