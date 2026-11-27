// Pure mappers between API DTOs and the browser shapes (`CustomerRecord`, `Customer`, `Machine`, `Quotation`,
// `HireAgreement`) that the existing screens and retained browser services consume. Money arrives as decimal
// strings and leaves the mapper as numbers for display only; totals are never recomputed here.
import type {
  CustomerDto, CustomerStatus, HireAgreementDto, MachineDto, MachineModelDto, PhaseHistoryDto, QuotationDto,
  QuotationPhase as ApiPhase,
} from '../../../shared/dto/index';
import type { Customer } from '@/types/customer';
import type { CustomerANIStatus, CustomerRecord } from '@/types/customerani';
import type { HireAgreement } from '@/types/hireagreement';
import type { Machine, MachineCategory, PowerSource } from '@/types/machine';
import type { PhaseHistoryEntry, Quotation, QuotationPhase } from '@/types/quotation';

const num = (v: string | number | null | undefined): number => {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

// ── Customers ───────────────────────────────────────────────────────────────

const CUSTOMER_STATUS_UI: Record<CustomerStatus, CustomerANIStatus> = {
  ACTIVE: 'Active', INACTIVE: 'Inactive', SUSPENDED: 'Suspended', BLACKLISTED: 'Blacklisted',
};
const CUSTOMER_STATUS_API: Record<CustomerANIStatus, CustomerStatus> = {
  Active: 'ACTIVE', Inactive: 'INACTIVE', Suspended: 'SUSPENDED', Blacklisted: 'BLACKLISTED',
};
export const customerStatusToApi = (s: CustomerANIStatus): CustomerStatus => CUSTOMER_STATUS_API[s];

/** `orgId` is the browser's current organization key; branch names come from the branches list. */
export function customerRecordFromDto(dto: CustomerDto, orgId: string, branchNames: ReadonlyMap<string, string> = new Map()): CustomerRecord {
  return {
    id: dto.id,
    orgId,
    fleetLogId: dto.fleetLogCode ?? '',
    aniRavaliActive: dto.aniRavaliActive,
    customerId: dto.customerCode,
    customerName: dto.name,
    trn: dto.taxRegistrationNo ?? '',
    attn: dto.attn ?? undefined,
    address: dto.address,
    email: dto.email ?? undefined,
    billingAddress: dto.billingAddress ?? undefined,
    attl: num(dto.creditLimit),
    contactNumber: dto.phone,
    status: CUSTOMER_STATUS_UI[dto.status],
    branchName: dto.branchId ? branchNames.get(dto.branchId) ?? '' : '',
    branchId: dto.branchId ?? undefined,
    rowVersion: dto.rowVersion,
    notes: dto.notes ?? undefined,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  };
}

/** The slim `Customer` shape used by retained screens (planner booking form). */
export function customerFromDto(dto: CustomerDto): Customer {
  return {
    id: dto.id,
    name: dto.name,
    contactPerson: dto.attn ?? '',
    phone: dto.phone,
    email: dto.email ?? '',
    city: '',
    country: 'UAE',
    activeBookings: 0,
    totalRevenue: 0,
    rating: 0,
    status: dto.status === 'ACTIVE' ? 'Active' : dto.status === 'BLACKLISTED' ? 'Blacklisted' : 'Inactive',
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    rowVersion: dto.rowVersion,
  };
}

// ── Machines ────────────────────────────────────────────────────────────────

export function machineFromDto(dto: MachineDto, model: MachineModelDto | undefined, branchName: string): Machine {
  return {
    id: dto.id,
    assetNumber: dto.assetNo,
    fleetNo: dto.fleetNo,
    serialNumber: dto.serialNo,
    make: model?.make ?? '',
    model: model?.model ?? '',
    category: (model?.category ?? '') as MachineCategory,
    status: dto.operationalStatus,
    branchId: dto.branchId,
    branchName,
    modelId: dto.modelId,
    powerSource: (dto.powerSource ?? model?.powerSource ?? 'Diesel') as PowerSource,
    platformHeight: num(dto.platformHeightM ?? model?.platformHeightM),
    workingHeight: num(dto.workingHeightM ?? model?.workingHeightM),
    capacity: num(dto.capacityKg ?? model?.capacityKg),
    year: dto.manufactureYear ?? 0,
    hoursOperated: num(dto.hoursOperated),
    lastInspection: dto.lastInspectionOn ?? '',
    nextInspection: dto.nextInspectionOn ?? '',
    nextPHI: dto.nextPhiOn ?? '',
    nextMandatory: dto.nextMandatoryOn ?? '',
    location: dto.currentLocation,
    documents: [],
    repairHistory: [],
    timeline: [],
    tpcExpiryDate: dto.tpcExpiresOn ?? undefined,
    tpcSupplier: dto.tpcSupplier ?? undefined,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    rowVersion: dto.rowVersion,
  };
}

// ── Quotations ──────────────────────────────────────────────────────────────

const PHASE_UI: Record<ApiPhase, QuotationPhase> = { AWAITING: 'Awaiting', TENDER: 'Tender', LOST: 'Lost', WON: 'Won' };
const PHASE_API: Record<QuotationPhase, ApiPhase> = { Awaiting: 'AWAITING', Tender: 'TENDER', Lost: 'LOST', Won: 'WON' };
export const phaseFromApi = (p: ApiPhase): QuotationPhase => PHASE_UI[p];
export const phaseToApi = (p: QuotationPhase): ApiPhase => PHASE_API[p];

export interface QuotationMapContext {
  orgId: string;
  /** customer uuid -> business code and name */
  customers: ReadonlyMap<string, { code: string; name: string }>;
  /** quotation id -> agreement number */
  agreementNoByQuotation?: ReadonlyMap<string, string>;
  /** user id -> display name */
  userNames?: ReadonlyMap<string, string>;
}

export function historyEntryFromDto(h: PhaseHistoryDto, userNames?: ReadonlyMap<string, string>): PhaseHistoryEntry {
  return {
    id: h.id,
    timestamp: h.occurredAt,
    user: (h.actorUserId && userNames?.get(h.actorUserId)) || (h.source === 'SYSTEM' ? 'System' : h.actorUserId ?? 'Unknown'),
    fromPhase: h.fromPhase ? PHASE_UI[h.fromPhase] : null,
    toPhase: PHASE_UI[h.toPhase],
    ...(h.reason ? { reason: h.reason } : {}),
  };
}

export function quotationFromDto(dto: QuotationDto, ctx: QuotationMapContext, history: PhaseHistoryDto[] = []): Quotation {
  const customer = ctx.customers.get(dto.customerId);
  return {
    id: dto.id,
    orgId: ctx.orgId,
    number: dto.quotationNo,
    opportunity: dto.opportunity,
    hireAgreementNo: ctx.agreementNoByQuotation?.get(dto.id) ?? '',
    email: dto.email ?? undefined,
    customerId: customer?.code ?? dto.customerId,
    customerName: customer?.name ?? '',
    amount: num(dto.amount),
    currency: dto.currencyCode,
    phase: PHASE_UI[dto.phase],
    lostReason: dto.lostReason ?? undefined,
    lostAt: dto.lostAt ?? undefined,
    lostBy: dto.lostBy ? ctx.userNames?.get(dto.lostBy) ?? dto.lostBy : undefined,
    salesRep: dto.salesUserId ? ctx.userNames?.get(dto.salesUserId) ?? undefined : undefined,
    validUntil: dto.validUntil ?? undefined,
    notes: dto.notes ?? undefined,
    history: history.map((h) => historyEntryFromDto(h, ctx.userNames)),
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    rowVersion: dto.rowVersion,
  };
}

// ── Hire agreements ─────────────────────────────────────────────────────────

function snapText(snapshot: Record<string, unknown> | null | undefined, ...keys: string[]): string {
  for (const k of keys) {
    const v = snapshot?.[k];
    if (typeof v === 'string' && v) return v;
  }
  return '';
}

export interface AgreementMapContext {
  orgId: string;
  customers: ReadonlyMap<string, { code: string; name: string }>;
}

export function agreementFromDto(dto: HireAgreementDto, ctx: AgreementMapContext): HireAgreement {
  const issuer = dto.issuerSnapshot;
  const cust = dto.customerSnapshot;
  const customer = ctx.customers.get(dto.customerId);
  return {
    id: dto.id,
    orgId: ctx.orgId,
    quotationId: dto.quotationId,
    agreementNo: dto.agreementNo,
    date: dto.agreementDate,
    status: dto.status,
    lessorName: snapText(issuer, 'name', 'legalName', 'companyName'),
    lessorTradeLicense: snapText(issuer, 'tradeLicense', 'tradeLicenseNo'),
    lessorTrn: snapText(issuer, 'taxRegistrationNo', 'trn'),
    lessorAddress: snapText(issuer, 'address'),
    lessorPhone: snapText(issuer, 'phone'),
    lessorEmail: snapText(issuer, 'email'),
    customerId: customer?.code ?? snapText(cust, 'customerCode') ?? dto.customerId,
    customerName: customer?.name ?? snapText(cust, 'name'),
    customerTrn: snapText(cust, 'taxRegistrationNo', 'trn'),
    attn: snapText(cust, 'attn'),
    contactPerson: snapText(cust, 'attn', 'contactPerson'),
    contactNumber: snapText(cust, 'phone', 'contactNumber'),
    customerEmail: snapText(cust, 'email'),
    billingAddress: snapText(cust, 'billingAddress', 'address'),
    equipmentName: dto.equipmentName,
    equipmentModel: dto.equipmentModel,
    serialNumber: dto.serialNumber,
    quantity: dto.quantity,
    capacity: dto.capacity,
    workingHeight: dto.workingHeight,
    deliveryLocation: dto.deliveryLocation,
    hireStartDate: dto.hireStartDate,
    hireEndDate: dto.hireEndDate,
    hireDuration: dto.hireDuration,
    monthlyRental: num(dto.monthlyRental),
    transportationCharges: num(dto.transportationCharges),
    subtotal: num(dto.subtotal),
    vat: num(dto.vatAmount),
    totalAmount: num(dto.totalAmount),
    paymentTerms: dto.paymentTerms,
    securityDeposit: num(dto.securityDeposit),
    paymentMethod: dto.paymentMethod,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    rowVersion: dto.rowVersion,
  };
}
