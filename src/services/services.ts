// Service abstraction layer.
//
// Each function in here returns a Promise that resolves to mock data.
// In Phase 2, replace the body of each function with a `fetch()` call Ã¢â‚¬â€
// the signatures stay the same, so no page component needs to change.

import {
  branches, customers, machines, bookings, workshopJobs, technicians, workshopBays,
  drivers, trucks, transportJobs, inspections, breakdowns, jobCards, users, notifications,
  gateEntries, crossHires,
  getBranchById, getCustomerById, getMachineById, getBookingById, getWorkshopJobById,
  getTechnicianById, getDriverById, getTruckById, getTransportJobById, getInspectionById,
  getBreakdownById, getJobCardById, getUserById, getInspectionsByType, getCrossHireById,
} from './mock';
import { CrossHire } from '@/types/crosshire';
import type { CustomerANI } from '@/types/customerani';
import type { HireAgreement } from '@/types/hireagreement';
import { useAuthStore, JA_ORG_ID } from '@/store/authStore';
import { useBookingStore } from '@/store/bookingStore';
import { ensureHireLinkDemo, ensureGateDemo } from './demoSeed';
import { useGateStore } from '@/store/gateStore';
import { mergeGateList } from './gateCore';
import type { GateRecord, GateStatus } from '@/types/gate';
import { useTransportStore, TransportRefExhaustedError } from '@/store/transportStore';
import {
  validateTransportForm, mapFormToRecord, toTransportJobView, mergeTransportList,
  type FieldErrors, type ViewCtx,
} from './transportCore';
import type { JobPatch, TransportJobStatus, TransportJobView } from '@/types/transport';
import { findDuplicateFleetNo, fleetNumberOf, type MachineLite } from './collectionCore';
import {
  InvoiceRuleError, createFromQuotation, getInvoice, listInvoices, removeInvoice, updateInvoice,
  type InvoiceEdits,
} from './quotationInvoicing';
import { useHireAgreementStore } from '@/store/hireAgreementStore';
import {
  assertQuotationMatchesCompany,
  findAllocationsForAgreement,
  HireAgreementInUseError,
} from './hireLink';
import {
  machinesForOrg, crossHiresForOrg, bookingsForOrg, workshopJobsForOrg,
  transportJobsForOrg, inspectionsForOrg, breakdownsForOrg, jobCardsForOrg,
  gateEntriesForOrg, customersForOrg, branchesForOrg,
  techniciansForOrg, workshopBaysForOrg, driversForOrg, trucksForOrg,
  usersForOrg, notificationsForOrg,
} from './mock/orgData';
import type { Customer } from '@/types/customer';
import type { CustomerRecord } from '@/types/customerani';
import { useCustomerStore } from '@/store/customerStore';
import { canonicalCustomerRecord, normalizeCustomerName } from './customerCore';

// Current tenant from the auth session (demo: read straight from the store).
function currentOrgId(): string {
  return useAuthStore.getState().user?.orgId ?? JA_ORG_ID;
}

// Simulate network latency
function delay<T>(data: T, ms = 180): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(data), ms));
}

export const branchService = {
  list: () => delay(branchesForOrg(currentOrgId())),
  get: (id: string) => delay(branchesForOrg(currentOrgId()).find((b) => b.id === id)),
  create: (data: any) => {
    const list = branchesForOrg(currentOrgId());
    const newBranch = {
      id: `br-${Date.now()}`,
      machineCount: 0,
      active: true,
      country: 'UAE',
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    list.push(newBranch as any);
    return delay(newBranch);
  },
  update: (id: string, data: any) => {
    const list = branchesForOrg(currentOrgId());
    const index = list.findIndex((b) => b.id === id);
    if (index === -1) throw new Error('Branch not found');
    list[index] = { ...list[index], ...data, updatedAt: new Date().toISOString() };
    return delay(list[index]);
  },
  delete: (id: string) => {
    const list = branchesForOrg(currentOrgId());
    const index = list.findIndex((b) => b.id === id);
    if (index === -1) throw new Error('Branch not found');
    list.splice(index, 1);
    return delay({ success: true });
  },
};

/**
 * Registry rows of a company. The five Customer ANI demo customers are added once per company
 * (same data every company got before); marked ids are never re-added after a delete.
 */
export function registryCustomers(orgId: string): CustomerRecord[] {
  // TODO(7.4): call ensureRentalDemo(orgId) here once it exists (it seeds all nine canonical customers).
  const store = useCustomerStore.getState();
  store.seedOrg(orgId, [0, 1, 2, 3, 4].map((i) => canonicalCustomerRecord(orgId, i)));
  return useCustomerStore.getState().forOrg(orgId);
}

function customerFromRegistry(c: CustomerRecord): Customer {
  return {
    id: c.id,
    name: c.customerName,
    contactPerson: c.attn ?? '',
    phone: c.contactNumber,
    email: c.email ?? '',
    city: '',
    country: 'UAE',
    activeBookings: 0,
    totalRevenue: 0,
    rating: 0,
    status: c.status === 'Active' ? 'Active' : 'Inactive',
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

/** Registry customers plus the company's legacy `cu-*` rows whose normalized name is not in the registry. */
function customersWithLegacy(orgId: string): Customer[] {
  const reg = registryCustomers(orgId);
  const names = new Set(reg.map((c) => normalizeCustomerName(c.customerName)));
  const legacy = (customersForOrg(orgId) as Customer[]).filter((c) => !names.has(normalizeCustomerName(c.name)));
  return [...reg.map(customerFromRegistry), ...legacy];
}

export const customerService = {
  list: () => delay(customersWithLegacy(currentOrgId())),
  get: (id: string) => delay(customersWithLegacy(currentOrgId()).find((c) => c.id === id)),
};

export class DuplicateFleetNoError extends Error {
  readonly existingId: string;
  constructor(fleetNo: string, existingId: string) {
    super('Duplicate fleet number');
    this.name = 'DuplicateFleetNoError';
    this.existingId = existingId;
    this.fleetNo = fleetNo;
  }
  fleetNo: string;
}

function assertNoDuplicateFleetNo(
  list: unknown[],
  candidate: { id?: string; orgId: string; fleetNo?: string; assetNumber: string },
): void {
  if (!fleetNumberOf(candidate)) return;
  const lite: MachineLite[] = (list as any[]).map((m) => ({
    id: m.id, orgId: currentOrgId(), fleetNo: m.fleetNo, assetNumber: m.assetNumber ?? '',
  }));
  const dup = findDuplicateFleetNo(lite, candidate);
  if (dup) throw new DuplicateFleetNoError(fleetNumberOf(candidate), dup.id);
}

export const machineService = {
  list: () => {
    ensureHireLinkDemo(currentOrgId());
    const list = machinesForOrg(currentOrgId());
    return delay(list);
  },
  get: (id: string) => delay(machinesForOrg(currentOrgId()).find((m) => m.id === id)),
  create: (data: Partial<typeof machines[0]>) => {
    const orgId = currentOrgId();
    const list = machinesForOrg(orgId);
    const input = { ...data } as any;
    // Keep fleetNo and assetNumber consistent when only one is supplied.
    if (!(input.fleetNo ?? '').trim() && (input.assetNumber ?? '').trim()) input.fleetNo = input.assetNumber;
    if (!(input.assetNumber ?? '').trim() && (input.fleetNo ?? '').trim()) input.assetNumber = input.fleetNo;
    assertNoDuplicateFleetNo(list, { orgId, fleetNo: input.fleetNo, assetNumber: input.assetNumber ?? '' });
    const newMachine = {
      ...input,
      id: `m-${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as typeof machines[0];
    list.push(newMachine);
    return delay(newMachine);
  },
  update: (id: string, data: Partial<typeof machines[0]>) => {
    const list = machinesForOrg(currentOrgId());
    const index = list.findIndex((m) => m.id === id);
    if (index === -1) throw new Error('Machine not found');
    const merged = { ...list[index], ...data } as any;
    assertNoDuplicateFleetNo(list, {
      id, orgId: currentOrgId(), fleetNo: merged.fleetNo, assetNumber: merged.assetNumber ?? '',
    });
    list[index] = { ...list[index], ...data, updatedAt: new Date().toISOString() };
    return delay(list[index]);
  },
  updateStatus: (id: string, status: string) => {
    const list = machinesForOrg(currentOrgId());
    const index = list.findIndex((m) => m.id === id);
    if (index === -1) throw new Error('Machine not found');
    list[index] = { ...list[index], status: status as any, updatedAt: new Date().toISOString() };
    return delay(list[index]);
  },
  delete: (id: string) => {
    const list = machinesForOrg(currentOrgId());
    const index = list.findIndex((m) => m.id === id);
    if (index === -1) throw new Error('Machine not found');
    list.splice(index, 1);
    return delay({ success: true });
  },
};

// Bookings saved from the Planner form live in useBookingStore. Show them next to the demo list so the
// calendar and booking views see them (records without an orgId belong to the demo org).
function savedBookingsForOrg(orgId: string) {
  return useBookingStore.getState().userBookings.filter((b) => (b.orgId ?? JA_ORG_ID) === orgId);
}

export const bookingService = {
  list: () => {
    ensureHireLinkDemo(currentOrgId());
    return delay([...bookingsForOrg(currentOrgId()), ...savedBookingsForOrg(currentOrgId())]);
  },
  get: (id: string) => delay([...bookingsForOrg(currentOrgId()), ...savedBookingsForOrg(currentOrgId())].find((b) => b.id === id)),
  forMachine: (machineId: string) => delay(bookingsForOrg(currentOrgId()).filter((b) => b.machineId === machineId)),
  create: (data: Partial<typeof bookings[0]>) => {
    const list = bookingsForOrg(currentOrgId());
    const newBooking = {
      ...data,
      id: `bk-${Date.now()}`,
      reference: `BK${Date.now().toString().slice(-6)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as typeof bookings[0];
    list.push(newBooking);
    return delay(newBooking);
  },
  update: (id: string, data: Partial<typeof bookings[0]>) => {
    const list = bookingsForOrg(currentOrgId());
    const index = list.findIndex((b) => b.id === id);
    if (index === -1) throw new Error('Booking not found');
    list[index] = { ...list[index], ...data, updatedAt: new Date().toISOString() };
    return delay(list[index]);
  },
  updateStatus: (id: string, status: string) => {
    const list = bookingsForOrg(currentOrgId());
    const index = list.findIndex((b) => b.id === id);
    if (index === -1) throw new Error('Booking not found');
    list[index] = { ...list[index], status: status as any, updatedAt: new Date().toISOString() };
    return delay(list[index]);
  },
  delete: (id: string) => {
    const list = bookingsForOrg(currentOrgId());
    const index = list.findIndex((b) => b.id === id);
    if (index === -1) throw new Error('Booking not found');
    list.splice(index, 1);
    return delay({ success: true });
  },
};

export const workshopService = {
  listJobs: () => delay(workshopJobsForOrg(currentOrgId())),
  getJob: (id: string) => delay(workshopJobsForOrg(currentOrgId()).find((j) => j.id === id)),
  // Technicians & bays are shared reference data in this demo; empty for new orgs.
  listTechnicians: () => delay(techniciansForOrg(currentOrgId())),
  getTechnician: (id: string) => delay(techniciansForOrg(currentOrgId()).find((t: any) => t.id === id)),
  listBays: () => delay(workshopBaysForOrg(currentOrgId())),
  createJob: (data: Partial<typeof workshopJobs[0]>) => {
    const list = workshopJobsForOrg(currentOrgId());
    const newJob = {
      ...data,
      id: `wj-${Date.now()}`,
      reference: `WJ${Date.now().toString().slice(-6)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as typeof workshopJobs[0];
    list.push(newJob);
    return delay(newJob);
  },
  updateJob: (id: string, data: Partial<typeof workshopJobs[0]>) => {
    const list = workshopJobsForOrg(currentOrgId());
    const index = list.findIndex((j) => j.id === id);
    if (index === -1) throw new Error('Workshop job not found');
    list[index] = { ...list[index], ...data, updatedAt: new Date().toISOString() };
    return delay(list[index]);
  },
  updateJobStatus: (id: string, status: string) => {
    const list = workshopJobsForOrg(currentOrgId());
    const index = list.findIndex((j) => j.id === id);
    if (index === -1) throw new Error('Workshop job not found');
    list[index] = { ...list[index], status: status as any, updatedAt: new Date().toISOString() };
    return delay(list[index]);
  },
  assignTechnician: (jobId: string, technicianId: string) => {
    const list = workshopJobsForOrg(currentOrgId());
    const index = list.findIndex((j) => j.id === jobId);
    if (index === -1) throw new Error('Workshop job not found');
    list[index] = { ...list[index], technicianId, updatedAt: new Date().toISOString() };
    return delay(list[index]);
  },
};

export class TransportValidationError extends Error {
  readonly errors: FieldErrors;
  constructor(errors: FieldErrors) {
    super('Transport job form is invalid');
    this.name = 'TransportValidationError';
    this.errors = errors;
  }
}

export { TransportRefExhaustedError };

function transportViewCtx(orgId: string): ViewCtx {
  return { machines: machinesForOrg(orgId) };
}

let transportIdSeq = 0;

export const transportService = {
  /** Synchronous merge of persisted rows and the company's mock rows (newest first). */
  listNow: (): TransportJobView[] => {
    const org = currentOrgId();
    // TODO(7.4): call ensureRentalDemo(org) here before reading, so demo jobs are seeded on first load.
    const st = useTransportStore.getState();
    return mergeTransportList(
      st.forOrg(org),
      transportJobsForOrg(org),
      org,
      st.overrides,
      transportViewCtx(org),
    );
  },
  listJobs: () => delay(transportService.listNow()),
  getJob: (id: string) => delay(transportService.listNow().find((t) => t.id === id)),
  listDrivers: () => {
    // TODO(7.4): call ensureRentalDemo(currentOrgId()) here.
    return delay(driversForOrg(currentOrgId()));
  },
  getDriver: (id: string) => delay(driversForOrg(currentOrgId()).find((d: any) => d.id === id)),
  listTrucks: () => {
    // TODO(7.4): call ensureRentalDemo(currentOrgId()) here.
    return delay(trucksForOrg(currentOrgId()));
  },
  getTruck: (id: string) => delay(trucksForOrg(currentOrgId()).find((t: any) => t.id === id)),
  /** Throws TransportValidationError or TransportRefExhaustedError. Stores nothing on failure. */
  create: async (data: unknown): Promise<TransportJobView> => {
    const checked = validateTransportForm(data);
    if (!checked.ok) throw new TransportValidationError(checked.errors);
    const org = currentOrgId();
    const st = useTransportStore.getState();
    const now = new Date();
    const ref = st.issueRef(org, now.getFullYear());
    const taken = new Set(st.jobs.map((j) => j.id));
    let id: string;
    do {
      transportIdSeq += 1;
      id = `tj-${now.getTime()}-${transportIdSeq}`;
    } while (taken.has(id));
    const ctx = transportViewCtx(org);
    const rec = mapFormToRecord(checked.form, {
      orgId: org, id, ref, now: now.toISOString(), machines: ctx.machines,
    });
    useTransportStore.getState().add(rec);
    return toTransportJobView(rec, ctx);
  },
  update: async (id: string, patch: JobPatch): Promise<TransportJobView> => {
    const org = currentOrgId();
    if (!transportService.listNow().some((t) => t.id === id)) throw new Error('Transport job not found');
    useTransportStore.getState().update(org, id, patch);
    const out = transportService.listNow().find((t) => t.id === id);
    if (!out) throw new Error('Transport job not found');
    return out;
  },
  updateStatus: (id: string, status: TransportJobStatus) => transportService.update(id, { status }),
};

export const inspectionService = {
  list: () => delay(inspectionsForOrg(currentOrgId())),
  get: (id: string) => delay(inspectionsForOrg(currentOrgId()).find((i) => i.id === id)),
  byType: (type: string) => delay(inspectionsForOrg(currentOrgId()).filter((i: any) => i.type === type)),
  // Create new PHI inspection record
  createPHI: (data: any) => {
    const newInsp = {
      ...data,
      id: `insp-phi-${Date.now()}`,
      reference: `PHI-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
      type: 'PHI',
      status: data.machineReadyForRental === 'Yes' ? 'Passed' : 'Failed',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    inspectionsForOrg(currentOrgId()).push(newInsp as any);
    return delay(newInsp);
  },
  // Create new PDI inspection record
  createPDI: (data: any) => {
    const newInsp = {
      ...data,
      id: `insp-pdi-${Date.now()}`,
      reference: `PDI-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
      type: 'PDI',
      status: 'Awaiting Approval',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    inspectionsForOrg(currentOrgId()).push(newInsp as any);
    return delay(newInsp);
  },
  // Create Mandatory Checks record
  createMandatory: (data: any) => {
    const newInsp = {
      ...data,
      id: `insp-mand-${Date.now()}`,
      reference: `MC-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
      type: 'Mandatory',
      status: data.overallStatus === 'Pass' ? 'Passed' : 'Failed',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    inspectionsForOrg(currentOrgId()).push(newInsp as any);
    return delay(newInsp);
  },
  // Create MQD record
  createMQD: (data: any) => {
    const newInsp = {
      ...data,
      id: `insp-mqd-${Date.now()}`,
      reference: `MQD-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
      type: 'MQD',
      status: 'Passed',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    inspectionsForOrg(currentOrgId()).push(newInsp as any);
    return delay(newInsp);
  },
  update: (id: string, data: Partial<typeof inspections[0]>) => {
    const list = inspectionsForOrg(currentOrgId());
    const index = list.findIndex((i) => i.id === id);
    if (index === -1) throw new Error('Inspection not found');
    list[index] = { ...list[index], ...data, updatedAt: new Date().toISOString() };
    return delay(list[index]);
  },
  updateChecklist: (id: string, checklist: typeof inspections[0]['checklist']) => {
    const list = inspectionsForOrg(currentOrgId());
    const index = list.findIndex((i) => i.id === id);
    if (index === -1) throw new Error('Inspection not found');
    list[index] = { ...list[index], checklist, updatedAt: new Date().toISOString() };
    return delay(list[index]);
  },
  submit: (id: string) => {
    const list = inspectionsForOrg(currentOrgId());
    const index = list.findIndex((i) => i.id === id);
    if (index === -1) throw new Error('Inspection not found');
    const passedCount = list[index].checklist.filter((item) => item.result === 'Pass').length;
    const totalCount = list[index].checklist.length;
    const overallResult = passedCount === totalCount ? 'Passed' : passedCount > totalCount * 0.7 ? 'Passed with Issues' : 'Failed';

    list[index] = {
      ...list[index],
      status: 'Awaiting Approval' as any,
      completedDate: new Date().toISOString(),
      overallResult: overallResult as any,
      updatedAt: new Date().toISOString(),
    };
    return delay(list[index]);
  },
};

export const breakdownService = {
  list: () => delay(breakdownsForOrg(currentOrgId())),
  get: (id: string) => delay(breakdownsForOrg(currentOrgId()).find((b) => b.id === id)),
  create: (data: Partial<typeof breakdowns[0]>) => {
    const listB = breakdownsForOrg(currentOrgId());
    const newBreakdown = {
      ...data,
      id: `bd-${Date.now()}`,
      reference: `BD${Date.now().toString().slice(-6)}`,
      reportedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as typeof breakdowns[0];
    listB.push(newBreakdown);
    return delay(newBreakdown);
  },
  update: (id: string, data: Partial<typeof breakdowns[0]>) => {
    const listB = breakdownsForOrg(currentOrgId());
    const index = listB.findIndex((b) => b.id === id);
    if (index === -1) throw new Error('Breakdown not found');
    listB[index] = { ...listB[index], ...data, updatedAt: new Date().toISOString() };
    return delay(listB[index]);
  },
  updateStatus: (id: string, status: string) => {
    const listB = breakdownsForOrg(currentOrgId());
    const index = listB.findIndex((b) => b.id === id);
    if (index === -1) throw new Error('Breakdown not found');
    listB[index] = { ...listB[index], status: status as any, updatedAt: new Date().toISOString() };
    return delay(listB[index]);
  },
  assignTechnician: (id: string, technicianId: string) => {
    const listB = breakdownsForOrg(currentOrgId());
    const index = listB.findIndex((b) => b.id === id);
    if (index === -1) throw new Error('Breakdown not found');
    listB[index] = { ...listB[index], technicianId, updatedAt: new Date().toISOString() };
    return delay(listB[index]);
  },
};

export const jobCardService = {
  list: () => delay(jobCardsForOrg(currentOrgId())),
  get: (id: string) => delay(jobCardsForOrg(currentOrgId()).find((j: any) => j.id === id)),
  create: (data: any) => {
    const list = jobCardsForOrg(currentOrgId());
    const newJobCard = {
      ...data,
      id: `jc-${Date.now()}`,
      reference: `JC-${new Date().getFullYear()}-${String(list.length + 1).padStart(4, '0')}`,
      status: 'Open',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    list.push(newJobCard as any);
    return delay(newJobCard);
  },
  update: (id: string, data: any) => {
    const list = jobCardsForOrg(currentOrgId());
    const index = list.findIndex((j: any) => j.id === id);
    if (index === -1) throw new Error('Job card not found');
    list[index] = { ...list[index], ...data, updatedAt: new Date().toISOString() };
    return delay(list[index]);
  },
};

export const userService = {
  list: () => delay(usersForOrg(currentOrgId())),
  get: (id: string) => delay(usersForOrg(currentOrgId()).find((u: any) => u.id === id)),
  create: (data: Partial<typeof users[0]>) => {
    const list = usersForOrg(currentOrgId());
    const newUser = {
      ...data,
      id: `u-${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as typeof users[0];
    list.push(newUser);
    return delay(newUser);
  },
  update: (id: string, data: Partial<typeof users[0]>) => {
    const list = usersForOrg(currentOrgId());
    const index = list.findIndex((u: any) => u.id === id);
    if (index === -1) throw new Error('User not found');
    list[index] = { ...list[index], ...data, updatedAt: new Date().toISOString() };
    return delay(list[index]);
  },
  delete: (id: string) => {
    const list = usersForOrg(currentOrgId());
    const index = list.findIndex((u: any) => u.id === id);
    if (index === -1) throw new Error('User not found');
    list.splice(index, 1);
    return delay({ success: true });
  },
};

export const notificationService = {
  list: () => delay(notificationsForOrg(currentOrgId())),
};

export const gateService = {
  list: () => {
    const orgId = currentOrgId();
    ensureGateDemo(orgId);
    return delay(mergeGateList(useGateStore.getState().entries, gateEntriesForOrg(orgId), orgId));
  },
  create: (data: any) => {
    const orgId = currentOrgId();
    const store = useGateStore.getState();
    const now = new Date().toISOString();
    // Throws GateRefExhaustedError at 9999 for the year: nothing is stored then.
    const reference: string = data?.reference ?? store.issueRef(orgId, new Date().getFullYear());
    const taken = new Set(store.entries.map((r) => r.id));
    let id: string = data?.id ?? `ge-${Date.now()}`;
    if (!data?.id) {
      for (let n = 1; taken.has(id); n += 1) id = `ge-${Date.now()}-${n}`;
    }
    const newEntry = {
      timestamp: now,
      ...data,
      id,
      reference,
      gatePass: data?.gatePass ?? reference,
      driver: data?.driver ?? '',
      destination: data?.destination ?? data?.arrivingFrom ?? '',
      status: 'Pending',
      createdAt: now,
      updatedAt: now,
      orgId, // always the current company, never the payload's
    } as GateRecord;
    useGateStore.getState().add(newEntry);
    return delay(newEntry);
  },
  approve: (id: string) => delay(changeGateStatus(id, 'Approved')),
  complete: (id: string) => delay(changeGateStatus(id, 'Completed')),
};

// Updates a stored record, or copies a mock row into the store (copy-on-write) with the new status.
function changeGateStatus(id: string, status: GateStatus): GateRecord {
  const orgId = currentOrgId();
  const store = useGateStore.getState();
  const now = new Date().toISOString();
  if (store.entries.some((r) => r.id === id && r.orgId === orgId)) {
    return store.update(id, { status, updatedAt: now });
  }
  const mock = gateEntriesForOrg(orgId).find((g) => g.id === id);
  if (!mock) throw new Error('Gate entry not found');
  return store.upsert({ ...mock, orgId, status, updatedAt: now });
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Cross Hire (sub-hire / re-hire) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

// Normalise a per-period rate to a monthly equivalent so Day/Week/Month deals
// can be summed into one comparable revenue figure (~30d month, ~4.33 wk/mo).
function toMonthly(rate: number, period: CrossHire['ratePeriod']): number {
  if (period === 'Day') return rate * 30;
  if (period === 'Week') return rate * 4.33;
  return rate;
}

// A cross-hire counts toward "active" revenue while the client leg is live.
const ACTIVE_CH: CrossHire['status'][] = ['Confirmed', 'On Hire', 'Off Hire'];

export const crossHireService = {
  list: () => delay(crossHiresForOrg(currentOrgId())),
  get: (id: string) => delay(crossHiresForOrg(currentOrgId()).find((c) => c.id === id)),
  create: (data: Partial<CrossHire>) => {
    const list = crossHiresForOrg(currentOrgId());
    const seq = String(list.length + 1).padStart(4, '0');
    const newCH = {
      quantity: 1,
      status: 'Enquiry',
      timeline: [],
      ...data,
      id: `ch-${Date.now()}`,
      reference: `CH-${new Date().getFullYear()}-${seq}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as CrossHire;
    list.push(newCH);
    return delay(newCH);
  },
  update: (id: string, data: Partial<CrossHire>) => {
    const list = crossHiresForOrg(currentOrgId());
    const index = list.findIndex((c) => c.id === id);
    if (index === -1) throw new Error('Cross hire not found');
    list[index] = { ...list[index], ...data, updatedAt: new Date().toISOString() };
    return delay(list[index]);
  },
  updateStatus: (id: string, status: CrossHire['status']) => {
    const list = crossHiresForOrg(currentOrgId());
    const index = list.findIndex((c) => c.id === id);
    if (index === -1) throw new Error('Cross hire not found');
    list[index] = { ...list[index], status, updatedAt: new Date().toISOString() };
    return delay(list[index]);
  },

  // Aggregate stats used by the Dashboard KPI row and the Reports section.
  // Scoped by branch the same way the rest of the dashboard is.
  getStats: (branchId?: string) => {
    const ids = branchScopeIds(branchId);
    const scoped = crossHiresForOrg(currentOrgId()).filter((c) => inScope(c.branchId, ids));
    const active = scoped.filter((c) => ACTIVE_CH.includes(c.status));

    const monthlyRevenue = active.reduce((s, c) => s + toMonthly(c.sellRate, c.ratePeriod) * c.quantity, 0);
    const monthlyCost = active.reduce((s, c) => s + toMonthly(c.buyRate, c.ratePeriod) * c.quantity, 0);
    const monthlyMargin = monthlyRevenue - monthlyCost;

    // Department / branch-wise breakdown
    const byBranchMap = scoped.reduce((acc, c) => {
      const key = c.branchName;
      if (!acc[key]) acc[key] = { branch: key, deals: 0, units: 0, revenue: 0, cost: 0, margin: 0 };
      const live = ACTIVE_CH.includes(c.status);
      acc[key].deals += 1;
      acc[key].units += c.quantity;
      if (live) {
        const rev = toMonthly(c.sellRate, c.ratePeriod) * c.quantity;
        const cost = toMonthly(c.buyRate, c.ratePeriod) * c.quantity;
        acc[key].revenue += rev;
        acc[key].cost += cost;
        acc[key].margin += rev - cost;
      }
      return acc;
    }, {} as Record<string, { branch: string; deals: number; units: number; revenue: number; cost: number; margin: number }>);

    const byStatus = scoped.reduce((acc, c) => {
      acc[c.status] = (acc[c.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return delay({
      total: scoped.length,
      activeDeals: active.length,
      onHire: scoped.filter((c) => c.status === 'On Hire').length,
      enquiries: scoped.filter((c) => c.status === 'Enquiry').length,
      totalUnits: active.reduce((s, c) => s + c.quantity, 0),
      monthlyRevenue: Math.round(monthlyRevenue),
      monthlyCost: Math.round(monthlyCost),
      monthlyMargin: Math.round(monthlyMargin),
      marginPct: monthlyRevenue > 0 ? Math.round((monthlyMargin / monthlyRevenue) * 100) : 0,
      byBranch: Object.values(byBranchMap).map((b) => ({
        ...b,
        revenue: Math.round(b.revenue),
        cost: Math.round(b.cost),
        margin: Math.round(b.margin),
      })),
      byStatus: Object.entries(byStatus).map(([label, value]) => ({ label, value })),
    });
  },
};

// Ã¢â€â‚¬Ã¢â€â‚¬ App onboarding (preset seeding) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
//
// Applies a "choose your setup" preset by creating its declarative records
// through the normal create services (so the data lands in the current org,
// scoped exactly like everything else). Backend-ready: this whole function
// becomes one API call later; the preset definitions can move server-side.

import { presetsForApp, type AppPreset } from '@/constants/appPresets';

// Ã¢â€â‚¬Ã¢â€â‚¬ Customer ANI service Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

// Reads and writes the persisted Customer_Registry (customerStore). create and update throw
// DuplicateCustomerError when the normalized name already exists in the company.
export const customerANIService = {
  list: () => delay(registryCustomers(currentOrgId())),
  get: (id: string) => delay(registryCustomers(currentOrgId()).find((c) => c.id === id)),
  create: (data: Partial<CustomerANI>) => {
    const orgId = currentOrgId();
    registryCustomers(orgId);
    return delay(useCustomerStore.getState().create(orgId, data));
  },
  update: (id: string, data: Partial<CustomerANI>) => {
    const orgId = currentOrgId();
    registryCustomers(orgId);
    return delay(useCustomerStore.getState().update(orgId, id, data));
  },
  delete: (id: string) => {
    const orgId = currentOrgId();
    registryCustomers(orgId);
    useCustomerStore.getState().remove(orgId, id);
    return delay({ success: true });
  },
};

// Which collections each app "owns" Ã¢â‚¬â€ used when clearing an app's data on a
// "start fresh" reactivation. Backend: this maps to deleting the app's rows.
const APP_COLLECTIONS: Record<string, Array<'machines' | 'crossHires' | 'branches' | 'customerANIs'>> = {
  fleet: ['machines'],
  cross_hire: ['crossHires'],
  branches: ['branches'],
  customer_ani: ['customerANIs'],
};

export const onboardingService = {
  async applyPreset(appId: string, presetId: string) {
    const preset: AppPreset | undefined = presetsForApp(appId).find((p) => p.id === presetId);
    if (!preset) throw new Error('Preset not found');
    if (preset.blank || !preset.records) return delay({ success: true, created: 0 });

    let created = 0;
    for (const m of preset.records.machines ?? []) {
      await machineService.create(m as any);
      created++;
    }
    for (const c of preset.records.crossHires ?? []) {
      await crossHireService.create(c as any);
      created++;
    }
    for (const b of preset.records.branches ?? []) {
      await branchService.create(b as any);
      created++;
    }
    for (const ca of (preset.records as any).customerANIs ?? []) {
      await customerANIService.create(ca);
      created++;
    }
    return delay({ success: true, created });
  },

  // Count the current records an app owns for the active org (used to show
  // "you have N previous records" on reactivation).
  countAppData(appId: string): number {
    const cols = APP_COLLECTIONS[appId] ?? [];
    const org = currentOrgId();
    let n = 0;
    if (cols.includes('machines')) n += machinesForOrg(org).length;
    if (cols.includes('crossHires')) n += crossHiresForOrg(org).length;
    if (cols.includes('branches')) n += branchesForOrg(org).length;
    if (cols.includes('customerANIs')) n += registryCustomers(org).length;
    return n;
  },

  // Wipe an app's records for the active org ("start fresh").
  async clearAppData(appId: string) {
    const cols = APP_COLLECTIONS[appId] ?? [];
    const org = currentOrgId();
    if (cols.includes('machines')) machinesForOrg(org).splice(0);
    if (cols.includes('crossHires')) crossHiresForOrg(org).splice(0);
    if (cols.includes('branches')) branchesForOrg(org).splice(0);
    if (cols.includes('customerANIs')) {
      registryCustomers(org); // mark the base seeds first so they are not re-added
      useCustomerStore.getState().clearOrg(org);
    }
    return delay({ success: true });
  },
};

// Ã¢â€â‚¬Ã¢â€â‚¬ Six Sigma metrics Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

export const sixSigmaService = {
  async getMetrics(branchId?: string) {
    const ids = branchScopeIds(branchId);
    const org = currentOrgId();
    const machines = machinesForOrg(org);
    const scopedMachines = machines.filter((m) => inScope(m.branchId, ids));
    const scopedBreakdowns = breakdownsForOrg(org).filter((b) => inScope((b as any).branchId, ids));
    const scopedWorkshopJobs = workshopJobsForOrg(org).filter((j) => inScope((j as any).branchId, ids));

    return delay({
      machines: scopedMachines,
      breakdowns: scopedBreakdowns,
      workshopJobs: scopedWorkshopJobs,
      inspections: inspectionsForOrg(org), // org-scoped
    });
  },
};

// Ã¢â€â‚¬Ã¢â€â‚¬ Dashboard aggregates Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

// Resolve which branch IDs a dashboard scope covers.
// 'all' Ã¢â€ â€™ every branch; 'uae' Ã¢â€ â€™ all UAE branches (excl. KSA); otherwise the single branch.
function branchScopeIds(branchId?: string): string[] | null {
  if (!branchId || branchId === 'all') return null; // null = no filtering
  if (branchId === 'uae') return branches.filter((b) => b.country === 'UAE').map((b) => b.id);
  return [branchId];
}

function inScope(itemBranchId: string | undefined, ids: string[] | null): boolean {
  if (!ids) return true;
  return !!itemBranchId && ids.includes(itemBranchId);
}

export const dashboardService = {
  async getKPIs(branchId?: string) {
    const ids = branchScopeIds(branchId);
    const org = currentOrgId();
    const machines = machinesForOrg(org);
    const scopedMachines = machines.filter((m) => inScope(m.branchId, ids));
    const scopedTransport = transportService.listNow().filter((j) => inScope((j as any).branchId, ids));
    const scopedBreakdowns = breakdownsForOrg(org).filter((b) => inScope((b as any).branchId, ids));
    const scopedBays = workshopBaysForOrg(org).filter((b) => inScope((b as any).branchId, ids));
    const scopedWsJobs = workshopJobsForOrg(org).filter((j) => inScope((j as any).branchId, ids));

    const statusCounts = scopedMachines.reduce((acc, m) => {
      acc[m.status] = (acc[m.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const todayDeliveries = scopedTransport.filter((j) => j.type === 'Delivery').length;
    const todayCollections = scopedTransport.filter((j) => j.type === 'Collection').length;
    const available = statusCounts['Available'] || 0;
    const onHire = statusCounts['On Hire'] || 0;
    const total = scopedMachines.length;

    return delay({
      total,
      available,
      onHire,
      underRepair: statusCounts['Under Repair'] || 0,
      inWorkshop: statusCounts['In Workshop'] || 0,
      pdi: statusCounts['PDI'] || 0,
      phi: statusCounts['PHI'] || 0,
      transport: statusCounts['Transport'] || 0,
      breakdowns: scopedBreakdowns.filter((b) => b.status === 'Open' || b.status === 'Assigned' || b.status === 'In Progress').length,
      offline: statusCounts['Offline'] || 0,
      todayDeliveries,
      todayCollections,
      fleetUtilization: total > 0 ? Math.round((onHire / total) * 100) : 0,
      workshopUtilization: scopedWsJobs.filter((j) => j.status !== 'Available' && j.status !== 'Quality Check').length > 0 && scopedBays.length > 0
        ? Math.round((scopedBays.filter((b) => b.status === 'Occupied').length / scopedBays.length) * 100)
        : 0,
    });
  },

  async getFleetByCategory(branchId?: string) {
    const ids = branchScopeIds(branchId);
    const machines = machinesForOrg(currentOrgId());
    const counts = machines.filter((m) => inScope(m.branchId, ids)).reduce((acc, m) => {
      acc[m.category] = (acc[m.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    return delay(Object.entries(counts).map(([label, value]) => ({ label, value })));
  },

  async getFleetByStatus(branchId?: string) {
    const ids = branchScopeIds(branchId);
    const machines = machinesForOrg(currentOrgId());
    const counts = machines.filter((m) => inScope(m.branchId, ids)).reduce((acc, m) => {
      acc[m.status] = (acc[m.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    return delay(Object.entries(counts).map(([label, value]) => ({ label, value })));
  },

  async getBranchUtilization(branchId?: string) {
    const ids = branchScopeIds(branchId);
    const orgBranches = branchesForOrg(currentOrgId());
    const machines = machinesForOrg(currentOrgId());
    // Show only the branches within scope (all when unfiltered)
    const scopedBranches = ids ? orgBranches.filter((b) => ids.includes(b.id)) : orgBranches;
    return delay(scopedBranches.map((b) => {
      const branchMachines = machines.filter((m) => m.branchId === b.id);
      const onHire = branchMachines.filter((m) => m.status === 'On Hire').length;
      const util = branchMachines.length > 0 ? Math.round((onHire / branchMachines.length) * 100) : 0;
      return { label: b.name, utilization: util, machines: branchMachines.length };
    }));
  },

  async getWorkshopPerformance(_branchId?: string) {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const seedData = [5, 7, 4, 8, 6, 3, 2];
    const intakeData = [4, 5, 6, 3, 5, 2, 1];
    return delay(days.map((day, i) => ({
      label: day,
      completed: seedData[i],
      intake: intakeData[i],
    })));
  },

  async getRecentActivity(branchId?: string) {
    const ids = branchScopeIds(branchId);
    const machines = machinesForOrg(currentOrgId());
    const allTimeline = machines.filter((m) => inScope(m.branchId, ids)).flatMap((m) =>
      m.timeline.map((t) => ({ ...t, machineAsset: m.assetNumber, machineModel: `${m.make} ${m.model}` }))
    );
    const breakdownTimeline = breakdownsForOrg(currentOrgId()).filter((b) => inScope((b as any).branchId, ids)).flatMap((b) =>
      b.timeline.map((t) => ({ ...t, machineAsset: b.assetNumber, machineModel: b.machineModel }))
    );
    return delay([...allTimeline, ...breakdownTimeline]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 12));
  },
};

// Ã¢â€â‚¬Ã¢â€â‚¬ Report aggregates Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

function computeSummary(period: 'daily' | 'weekly' | 'monthly') {
  const org = currentOrgId();
  const machines = machinesForOrg(org);
  const bookings = bookingsForOrg(org);
  const breakdowns = breakdownsForOrg(org);
  const workshopJobs = workshopJobsForOrg(org);
  const multiplier = period === 'daily' ? 1 : period === 'weekly' ? 7 : 30;
  const onHire = machines.filter((m) => m.status === 'On Hire');
  const activeBookings = bookings.filter((b) => b.status === 'On Hire' || b.status === 'Approved' || b.status === 'Allocated');
  const totalRevenue = activeBookings.reduce((sum, b) => sum + b.totalValue, 0);
  const avgDailyRate = activeBookings.length > 0 ? totalRevenue / activeBookings.length : 0;
  const periodRevenue = Math.round(avgDailyRate * multiplier * activeBookings.length * 0.8);

  return {
    totalRevenue: periodRevenue,
    utilizationRate: machines.length > 0 ? Math.round((onHire.length / machines.length) * 100) : 0,
    totalHires: activeBookings.length * (period === 'daily' ? 1 : period === 'weekly' ? 4 : 16),
    totalBreakdowns: breakdowns.length * (period === 'daily' ? 1 : period === 'weekly' ? 2 : 6),
    avgRepairTime: workshopJobs.length > 0 ? Math.round((workshopJobs.reduce((s, j) => s + (j.actualHours ?? j.estimatedHours), 0) / workshopJobs.length) * 10) / 10 : 0,
    fleetAvailability: machines.length > 0 ? Math.round(((machines.length - breakdowns.filter((b) => b.status !== 'Closed' && b.status !== 'Resolved').length) / machines.length) * 100) : 0,
  };
}

export const reportService = {
  async getDailySummary() { return delay(computeSummary('daily')); },
  async getWeeklySummary() { return delay(computeSummary('weekly')); },
  async getMonthlySummary() { return delay(computeSummary('monthly')); },

  async getRevenueTrend(period: 'daily' | 'weekly' | 'monthly') {
    const labels = period === 'daily'
      ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      : period === 'weekly'
      ? ['W20', 'W21', 'W22', 'W23', 'W24', 'W25', 'W26', 'W27', 'W28', 'W29', 'W30', 'W31']
      : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const baseRevenue = period === 'daily' ? 45000 : period === 'weekly' ? 280000 : 1100000;
    const baseHires = period === 'daily' ? 10 : period === 'weekly' ? 55 : 240;

    return delay(labels.map((label, i) => ({
      label,
      revenue: Math.round(baseRevenue + Math.sin(i * 0.6) * (baseRevenue * 0.15) + i * (baseRevenue * 0.02)),
      hires: Math.round(baseHires + Math.cos(i * 0.8) * (baseHires * 0.2) + i * 0.5),
    })));
  },

  async getBranchPerformance() {
    const org = currentOrgId();
    const machines = machinesForOrg(org);
    const bookings = bookingsForOrg(org);
    const breakdowns = breakdownsForOrg(org);
    return delay(branchesForOrg(org).map((b) => {
      const branchMachines = machines.filter((m) => m.branchId === b.id);
      const onHire = branchMachines.filter((m) => m.status === 'On Hire').length;
      const branchBookings = bookings.filter((bk) => bk.branchId === b.id);
      return {
        branch: b.name,
        utilization: branchMachines.length > 0 ? Math.round((onHire / branchMachines.length) * 100) : 0,
        revenue: branchBookings.reduce((s, bk) => s + bk.totalValue, 0),
        machines: branchMachines.length,
        breakdowns: breakdowns.filter((bd) => bd.branchId === b.id).length,
      };
    }));
  },

  async getWorkshopReport() {
    const workshopJobs = workshopJobsForOrg(currentOrgId());
    const statusCounts = workshopJobs.reduce((acc, j) => {
      acc[j.status] = (acc[j.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return delay({
      byStatus: Object.entries(statusCounts).map(([label, value]) => ({ label, value })),
      throughput: days.map((d, i) => ({ label: d, completed: [4, 6, 5, 7, 5, 3, 2][i], intake: [5, 4, 6, 4, 6, 2, 3][i] })),
      avgRepairDays: workshopJobs.length > 0 ? Math.round((workshopJobs.reduce((s, j) => s + j.estimatedHours, 0) / workshopJobs.length / 8) * 10) / 10 : 0,
      jobsCompleted: workshopJobs.filter((j) => j.completedDate).length,
      jobsOpen: workshopJobs.filter((j) => !j.completedDate).length,
    });
  },

  async getTransportReport() {
    const transportJobs = transportService.listNow();
    const statusCounts = transportJobs.reduce((acc, j) => {
      acc[j.status] = (acc[j.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return delay({
      byStatus: Object.entries(statusCounts).map(([label, value]) => ({ label, value })),
      dailyTrips: days.map((d, i) => ({ label: d, deliveries: [3, 5, 4, 6, 5, 2, 1][i], collections: [2, 3, 4, 2, 3, 1, 1][i] })),
      totalDistance: Math.round(transportJobs.reduce((s, j) => s + (j.distance ?? 0), 0)),
      completedToday: transportJobs.filter((j) => j.status === 'Completed' || j.status === 'Delivered').length,
    });
  },

  async getBreakdownReport() {
    const breakdowns = breakdownsForOrg(currentOrgId());
    const severityCounts = breakdowns.reduce((acc, b) => {
      acc[b.severity] = (acc[b.severity] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const months = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
    return delay({
      bySeverity: Object.entries(severityCounts).map(([label, value]) => ({ label, value })),
      monthly: months.map((m, i) => ({ label: m, value: Math.round(8 + Math.sin(i * 0.5) * 4) })),
      avgDowntime: Math.round((breakdowns.filter((b) => b.downtimeHours).reduce((s, b) => s + (b.downtimeHours || 0), 0) / Math.max(breakdowns.filter((b) => b.downtimeHours).length, 1)) * 10) / 10,
      openCases: breakdowns.filter((b) => b.status === 'Open' || b.status === 'In Progress').length,
    });
  },
};

// -- Hire Agreement service --------------------------------------------------

export const hireAgreementService = {
  list: () => {
    const orgId = currentOrgId();
    ensureHireLinkDemo(orgId);
    const store = useHireAgreementStore.getState();
    store.ensureSeeded(orgId);
    return delay(store.forOrg(orgId));
  },
  get: (id: string) => {
    const orgId = currentOrgId();
    const store = useHireAgreementStore.getState();
    store.ensureSeeded(orgId);
    return delay(store.forOrg(orgId).find((h) => h.id === id));
  },
  create: (data: Partial<HireAgreement>) => {
    const orgId = currentOrgId();
    const store = useHireAgreementStore.getState();
    store.ensureSeeded(orgId);
    const seq = store.forOrg(orgId).length + 1;
    const year = new Date().getFullYear();
    const now = new Date().toISOString();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, orgId: _orgId, createdAt: _c, updatedAt: _u, ...rest } = data;
    const newRecord: HireAgreement = {
      agreementNo: 'HA-' + year + '-' + String(seq).padStart(3, '0'),
      date: now.slice(0, 10),
      status: 'Draft',
      lessorName: '', lessorTradeLicense: '', lessorTrn: '',
      lessorAddress: '', lessorPhone: '', lessorEmail: '',
      customerId: '', customerName: '', customerTrn: '',
      attn: '', contactPerson: '', contactNumber: '',
      customerEmail: '', billingAddress: '',
      equipmentName: '', equipmentModel: '', serialNumber: '',
      quantity: 1, capacity: '', workingHeight: '',
      deliveryLocation: '', hireStartDate: '', hireEndDate: '', hireDuration: '',
      monthlyRental: 0, transportationCharges: 0, subtotal: 0,
      vat: 0, totalAmount: 0, paymentTerms: '30 Days',
      securityDeposit: 0, paymentMethod: 'Bank Transfer',
      ...rest,
      id: store.newId(),
      orgId,
      quotationId: data.quotationId ?? '',
      createdAt: now,
      updatedAt: now,
    } as HireAgreement;
    assertQuotationMatchesCompany(orgId, newRecord);
    store.insert(newRecord);
    return delay(newRecord);
  },
  update: (id: string, data: Partial<HireAgreement>) => {
    const orgId = currentOrgId();
    const store = useHireAgreementStore.getState();
    const existing = store.getById(id);
    if (!existing || existing.orgId !== orgId) throw new Error('Hire agreement not found');
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, orgId: _orgId, createdAt: _c, ...rest } = data;
    assertQuotationMatchesCompany(orgId, { ...existing, ...rest });
    return delay(store.patch(id, { ...rest, updatedAt: new Date().toISOString() }));
  },
  delete: (id: string) => {
    const orgId = currentOrgId();
    const store = useHireAgreementStore.getState();
    const existing = store.getById(id);
    if (!existing || existing.orgId !== orgId) throw new Error('Hire agreement not found');
    const refs = findAllocationsForAgreement(id);
    if (refs.length > 0) throw new HireAgreementInUseError(refs);
    store.remove(id);
    return delay({ success: true });
  },
};
// -- Tax Invoice service -----------------------------------------------------

const INVOICE_EDIT_KEYS = [
  'invoiceDate', 'currency', 'notes', 'equipmentDescription', 'equipmentQty', 'equipmentRate',
  'transportationQty', 'transportationRate', 'paymentMethod', 'securityDeposit', 'billingAddress',
  'dueDate', 'deliveryLocation', 'paymentTerms', 'customerTrn', 'attn', 'contactNumber', 'customerEmail',
] as const;

export const taxInvoiceService = {
  list: () => delay(listInvoices()),
  get: (id: string) => delay(getInvoice(id)),
  create: (data: any) => {
    try {
      if (!data?.quotationId) throw new InvoiceRuleError('QUOTATION_REQUIRED');
      const edits: Record<string, unknown> = {};
      for (const k of INVOICE_EDIT_KEYS) if (data[k] !== undefined) edits[k] = data[k];
      return delay(
        createFromQuotation({
          quotationId: data.quotationId,
          invoiceType: data.invoiceType,
          periodEnd: data.periodEnd,
          periodStart: data.periodStart,
          edits: edits as InvoiceEdits,
        }),
      );
    } catch (e) {
      return Promise.reject(e);
    }
  },
  update: (id: string, data: any) => {
    try {
      return delay(updateInvoice(id, data));
    } catch (e) {
      return Promise.reject(e);
    }
  },
  delete: (id: string) => {
    try {
      removeInvoice(id, 'delete');
      return delay({ success: true });
    } catch (e) {
      return Promise.reject(e);
    }
  },
};