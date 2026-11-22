// Pure core (type-only imports): Customer_Registry rules. Name matching, find-or-create planning,
// the canonical demo customers, demo spelling fixes and the links of one customer.

import type { CustomerANI, CustomerRecord } from '@/types/customerani';
import type { Quotation } from '@/types/quotation';
import type { HireAgreement } from '@/types/hireagreement';
import type { TaxInvoice } from '@/types/taxinvoice';

const JA_ORG = 'org-ja';

/** Demo ids `cani-1..cani-9` are reserved for the canonical set. New customers start above this. */
export const CANONICAL_SEQ_FLOOR = 9;
/** The highest canonical customerId number (CUST-000604). New customer ids start above it. */
export const CANONICAL_ID_FLOOR = 604;

export interface CanonicalCustomer extends Omit<CustomerANI, 'id' | 'fleetLogId' | 'customerName'> {
  customerId: string;
  name: string;
}

const ts = (d: string) => `${d}T08:00:00.000Z`;

/** Canonical demo set of Req 4.2 and 4.12. Order fixes the demo record ids (`cani-1` to `cani-9`). */
export const CANONICAL_DEMO_CUSTOMERS: readonly CanonicalCustomer[] = [
  {
    customerId: 'CUST-000125', name: 'ABC Company LLC', aniRavaliActive: true, trn: '100412345600003',
    attn: 'Mr. Virat Kohli', address: 'ABC Tower, 14th Floor, Sheikh Zayed Rd, Dubai, UAE',
    billingAddress: 'ABC Tower, 14th Floor, Sheikh Zayed Rd, Dubai, UAE', email: 'virat.kohli@abccompany.com',
    attl: 500000, contactNumber: '+971 50 123 4567', status: 'Active', branchName: 'Dubai HQ',
    createdAt: '2024-03-10T08:00:00.000Z', updatedAt: '2025-01-15T10:30:00.000Z',
  },
  {
    customerId: 'CUST-000248', name: 'DEF Company LLC', aniRavaliActive: true, trn: '100567890100003',
    attn: 'Mr. Rohit Sharma', address: 'DEF Building, Airport Rd, Abu Dhabi, UAE',
    billingAddress: 'DEF Building, Airport Rd, Abu Dhabi, UAE', email: 'rohit.sharma@defcompany.com',
    attl: 750000, contactNumber: '+971 50 234 5678', status: 'Active', branchName: 'Abu Dhabi',
    createdAt: '2024-05-20T09:15:00.000Z', updatedAt: '2025-02-10T11:00:00.000Z',
  },
  {
    customerId: 'CUST-000371', name: 'GHI Company PJSC', aniRavaliActive: true, trn: '100789012300003',
    attn: 'Mr. Steve Smith', address: 'GHI HQ, Palm Jumeirah, Dubai, UAE',
    billingAddress: 'GHI HQ, Palm Jumeirah, Dubai, UAE', email: 'steve.smith@ghicompany.com',
    attl: 900000, contactNumber: '+971 50 345 6789', status: 'Active', branchName: 'Dubai HQ',
    createdAt: '2024-07-05T07:30:00.000Z', updatedAt: '2025-03-01T14:20:00.000Z',
  },
  {
    customerId: 'CUST-000419', name: 'JKL Company LLC', aniRavaliActive: true, trn: '100890123400003',
    attn: 'Mr. Joe Root', address: 'JKL Square, Downtown Dubai, UAE',
    billingAddress: 'JKL Square, Downtown Dubai, UAE', email: 'joe.root@jklcompany.com',
    attl: 1200000, contactNumber: '+971 50 456 7890', status: 'Active', branchName: 'Dubai HQ',
    createdAt: '2024-02-14T10:00:00.000Z', updatedAt: '2025-01-28T09:45:00.000Z',
  },
  {
    customerId: 'CUST-000532', name: 'MNO Company LLC', aniRavaliActive: true, trn: '100901234500003',
    attn: 'Mr. Kane Williamson', address: 'MNO Centre, Al Qasimia, Sharjah, UAE',
    billingAddress: 'MNO Centre, Al Qasimia, Sharjah, UAE', email: 'kane.williamson@mnocompany.com',
    attl: 650000, contactNumber: '+971 50 567 8901', status: 'Active', branchName: 'Sharjah',
    createdAt: '2024-08-18T08:45:00.000Z', updatedAt: '2025-04-05T12:10:00.000Z',
  },
  {
    customerId: 'CUST-000601', name: 'CK Groups', aniRavaliActive: false, trn: '100234567800003',
    attn: 'Mr. Chris Gayle', address: 'CK Plaza, Business Bay, Dubai, UAE',
    billingAddress: 'CK Plaza, Business Bay, Dubai, UAE', email: 'accounts@ckgroups.com',
    attl: 400000, contactNumber: '+971 50 678 9012', status: 'Active', branchName: 'Dubai HQ',
    createdAt: ts('2024-09-01'), updatedAt: ts('2025-01-05'),
  },
  {
    customerId: 'CUST-000602', name: 'Damac Properties', aniRavaliActive: false, trn: '100345678900003',
    attn: 'Mr. Brian Lara', address: 'Damac Heights, Dubai Marina, Dubai, UAE',
    billingAddress: 'Damac Heights, Dubai Marina, Dubai, UAE', email: 'procurement@damacproperties.com',
    attl: 2000000, contactNumber: '+971 50 789 0123', status: 'Active', branchName: 'Dubai HQ',
    createdAt: ts('2024-09-12'), updatedAt: ts('2025-02-02'),
  },
  {
    customerId: 'CUST-000603', name: 'Arabtec Construction LLC', aniRavaliActive: false, trn: '100456789000003',
    attn: 'Mr. Ricky Ponting', address: 'Arabtec House, Mussafah, Abu Dhabi, UAE',
    billingAddress: 'Arabtec House, Mussafah, Abu Dhabi, UAE', email: 'projects@arabtec.com',
    attl: 1500000, contactNumber: '+971 50 890 1234', status: 'Active', branchName: 'Abu Dhabi',
    createdAt: ts('2024-10-03'), updatedAt: ts('2025-03-09'),
  },
  {
    customerId: 'CUST-000604', name: 'Administrator', aniRavaliActive: false, trn: '',
    attn: 'Administrator', address: 'Head Office, UAE', billingAddress: 'Head Office, UAE',
    email: 'admin@example.com', attl: 0, contactNumber: '', status: 'Active', branchName: 'Head Office',
    createdAt: ts('2024-01-01'), updatedAt: ts('2024-01-01'),
  },
];

/** The nine names of Req 4.2. */
export const CANONICAL_DEMO_NAMES: readonly string[] = CANONICAL_DEMO_CUSTOMERS.map((c) => c.name);

/** Non-canonical demo spellings and their canonical replacement (exact match only). */
export const DEMO_SPELLING_FIXES: Readonly<Record<string, string>> = {
  'ABC Company': 'ABC Company LLC',
  'Arabtec Contracting': 'Arabtec Construction LLC',
};

/** Exact-match replacement of a non-canonical demo spelling. Any other text is returned unchanged. */
export function canonicalizeDemoName(s: string): string {
  return Object.prototype.hasOwnProperty.call(DEMO_SPELLING_FIXES, s) ? DEMO_SPELLING_FIXES[s] : s;
}

/** The canonical demo customer whose name equals `name` exactly, if any. */
export function canonicalCustomerByName(name: string): CanonicalCustomer | undefined {
  return CANONICAL_DEMO_CUSTOMERS.find((c) => c.name === name);
}

const SUFFIX_RE = /[\s,]+(?:l\.?\s?l\.?\s?c|p\.?\s?j\.?\s?s\.?\s?c)\.?$/;

/** Lower case, trim, collapse inner spaces, drop a trailing LLC or PJSC (optional dots and commas). */
export function normalizeCustomerName(s: string): string {
  let out = String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  for (;;) {
    const next = out.replace(SUFFIX_RE, '').trim();
    if (next === out) return out;
    out = next;
  }
}

type Named = { orgId: string } & ({ customerName: string } | { name: string });
const nameOf = (r: Named): string => ('customerName' in r ? r.customerName : r.name);

/** The customer of the company whose normalized name equals the normalized `name`. */
export function findCustomer<T extends Named>(list: readonly T[], orgId: string, name: string): T | undefined {
  const key = normalizeCustomerName(name);
  return list.find((c) => c.orgId === orgId && normalizeCustomerName(nameOf(c)) === key);
}

/** Id of the nth demo or user customer of a company: `cani-<n>` for org-ja, `cani-<orgId>-<n>` otherwise. */
export function customerRecordId(orgId: string, n: number): string {
  return orgId === JA_ORG ? `cani-${n}` : `cani-${orgId}-${n}`;
}

function seqOfId(orgId: string, id: string): number {
  const prefix = orgId === JA_ORG ? 'cani-' : `cani-${orgId}-`;
  if (!id.startsWith(prefix)) return 0;
  const rest = id.slice(prefix.length);
  return /^\d+$/.test(rest) ? Number(rest) : 0;
}

/** Next free record id of the company, always above the canonical demo ids. */
export function nextCustomerRecordId(list: readonly CustomerRecord[], orgId: string): string {
  let max = CANONICAL_SEQ_FLOOR;
  for (const c of list) if (c.orgId === orgId) max = Math.max(max, seqOfId(orgId, c.id));
  return customerRecordId(orgId, max + 1);
}

/** Next `CUST-<6 digits>`, above every existing id of the company and above the canonical set. */
export function nextCustomerId(list: readonly CustomerRecord[], orgId: string): string {
  let max = CANONICAL_ID_FLOOR;
  for (const c of list) {
    if (c.orgId !== orgId) continue;
    const m = /^CUST-(\d+)$/.exec(c.customerId);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `CUST-${String(max + 1).padStart(6, '0')}`;
}

function nextFleetLogId(list: readonly CustomerRecord[], orgId: string): string {
  let max = 0;
  for (const c of list) {
    if (c.orgId !== orgId) continue;
    const m = /^FL-(\d+)$/.exec(c.fleetLogId ?? '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `FL-${String(max + 1).padStart(5, '0')}`;
}

/** A new customer record with the Customers app defaults. `data` overrides the defaults. */
export function buildCustomerRecord(
  list: readonly CustomerRecord[], orgId: string, data: Partial<CustomerANI>, id: string, now: string,
): CustomerRecord {
  return {
    fleetLogId: nextFleetLogId(list, orgId),
    aniRavaliActive: false,
    customerId: nextCustomerId(list, orgId),
    customerName: '',
    trn: '',
    address: '',
    attl: 0,
    contactNumber: '',
    status: 'Active',
    branchName: 'Head Office',
    createdAt: now,
    updatedAt: now,
    ...data,
    id,
    orgId,
  };
}

/** The registry record of a canonical demo customer for a company (`index` is 0-based). */
export function canonicalCustomerRecord(orgId: string, index: number): CustomerRecord {
  const { name, ...rest } = CANONICAL_DEMO_CUSTOMERS[index];
  return {
    ...rest,
    id: customerRecordId(orgId, index + 1),
    fleetLogId: `FL-${String(index + 1).padStart(5, '0')}`,
    customerName: name,
    orgId,
  };
}

/**
 * Finds the customer of the company by normalized name, or plans a new one.
 * An existing customer (and its customerId) is returned unchanged.
 */
export function planFindOrCreate(
  list: readonly CustomerRecord[], orgId: string, name: string, newId: () => string, now: string,
): { customer: CustomerRecord; created: boolean } {
  const hit = findCustomer(list, orgId, name);
  if (hit) return { customer: hit, created: false };
  const customer = buildCustomerRecord(list, orgId, { customerName: String(name ?? '').trim() }, newId(), now);
  return { customer, created: true };
}

export interface LinkSnapshot {
  quotations: readonly Quotation[];
  agreements: readonly HireAgreement[];
  invoices: readonly TaxInvoice[];
}

/** Quotations, hire agreements and invoices of one company that carry the customer's `customerId`. */
export function linksForCustomer(
  s: LinkSnapshot, orgId: string, customerId: string,
): { quotations: Quotation[]; agreements: HireAgreement[]; invoices: TaxInvoice[] } {
  const mine = <T extends { orgId?: string; customerId: string }>(r: T) =>
    r.orgId === orgId && r.customerId === customerId;
  return {
    quotations: s.quotations.filter(mine),
    agreements: s.agreements.filter(mine),
    invoices: s.invoices.filter(mine),
  };
}
