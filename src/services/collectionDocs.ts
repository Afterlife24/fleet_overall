import { useMemo } from 'react';
import { JA_ORG_ID, useAuthStore } from '@/store/authStore';
import { useOrgStore } from '@/store/orgStore';
import { useCrmStore } from '@/store/crmStore';
import { useHireAgreementStore } from '@/store/hireAgreementStore';
import { useBookingStore } from '@/store/bookingStore';
import { useTaxInvoiceStore } from '@/store/taxInvoiceStore';
import { useCollectionStore } from '@/store/collectionStore';
import { useMqdStore } from '@/store/mqdStore';
import { useThirdPartyStore } from '@/store/thirdPartyStore';
import { machinesForOrg } from '@/services/mock/orgData';
import { ensureCollectionDemo, ensureHireLinkDemo } from '@/services/demoSeed';
import {
  pickNoteToCollect,
  pickerMachines,
  planInitiate,
  resolveFleetQuery,
  resolveQr,
  resolveReferences,
  type DeepLinkResult,
  type InitiateError,
  type MachineLite,
  type QrResult,
  type RefSnapshot,
} from '@/services/collectionCore';
import type { CollectionNote, DocType, MqdRecord, ReferenceFields, SignedStatus, TpsDocument } from '@/types/collection';
import type { Inspection } from '@/types/inspection';

export type MachineResolver = {
  list(orgId: string): MachineLite[];
  statusOf(machineId: string): string;
};
export type TransportJobCallback = (cn: CollectionNote) => void;

export interface InitiateResult {
  ok: boolean;
  error?: InitiateError;
  cn?: CollectionNote;
  mqd?: MqdRecord;
  tps?: TpsDocument;
  notices: { level: 'info' | 'error'; message: string }[];
}

export interface MqdRow {
  id: string;
  reference: string;
  fleetNo: string;
  hirer: string;
  collectionNo: string;
  signedStatus: SignedStatus;
  persisted: boolean;
}

const currentOrgId = (): string => useAuthStore.getState().user?.orgId ?? JA_ORG_ID;

function yearOf(date: string): number {
  const y = Number(/^(\d{4})/.exec(date)?.[1]);
  return Number.isFinite(y) && y > 0 ? y : new Date().getFullYear();
}

function snapshot(orgId: string): RefSnapshot {
  return {
    orgId,
    bookings: useBookingStore.getState().userBookings,
    agreements: useHireAgreementStore.getState().agreements,
    quotations: useCrmStore.getState().quotations,
    invoices: useTaxInvoiceStore.getState().invoices,
  } as RefSnapshot;
}

function refFieldsOf(r: ReferenceFields): ReferenceFields {
  return { ...r, missing: [...r.missing], refNotes: [...r.refNotes] };
}

export function initiateOffHire(args: {
  machineId: string;
  date: string;
  machines: MachineResolver;
  createTransportJob?: TransportJobCallback;
}): InitiateResult {
  const notices: InitiateResult['notices'] = [];
  const orgId = currentOrgId();
  try {
    ensureHireLinkDemo(orgId);
    ensureCollectionDemo(orgId);
  } catch (err) {
    console.error('[collectionDocs]', err);
  }
  const machine = args.machines.list(orgId).find((m) => m.id === args.machineId);
  if (!machine) {
    notices.push({ level: 'error', message: 'Machine not found in this organisation' });
    return { ok: false, error: 'WRONG_ORG', notices };
  }
  const status = args.machines.statusOf(machine.id);
  const org = useOrgStore.getState();
  const mqdActive = org.isAppActive(orgId, 'mqd');
  const tpsActive = org.isAppActive(orgId, 'third_party_services');
  const transportActive = org.isAppActive(orgId, 'transport');
  const year = yearOf(args.date);
  const refs = resolveReferences(machine, undefined, snapshot(orgId));

  const cs = useCollectionStore.getState();
  const ms = useMqdStore.getState();
  const ts = useThirdPartyStore.getState();
  const ids = { cn: cs.newId(), mqd: ms.newId(), tps: ts.newId() };

  // Check eligibility before consuming numbers.
  const probe = planInitiate(
    { orgId, machine, status, mqdActive, tpsActive, transportActive, date: args.date, year, ids, refs },
    { cn: '', mqd: '', tps: '' },
  );
  if (!probe.ok) {
    notices.push({
      level: 'error',
      message: probe.error === 'NOT_ON_HIRE' ? 'Machine is not On Hire' : 'Machine belongs to another organisation',
    });
    return { ok: false, error: probe.error, notices };
  }

  const numbers = {
    cn: cs.issueNumber(orgId, year),
    mqd: mqdActive ? ms.issueNumber(orgId, year) : undefined,
    tps: tpsActive ? ts.issueNumber(orgId, year) : undefined,
  };
  const plan = planInitiate(
    { orgId, machine, status, mqdActive, tpsActive, transportActive, date: args.date, year, ids, refs },
    numbers,
  );
  if (!plan.ok) return { ok: false, error: plan.error, notices };

  cs.insert(plan.cn);
  if (plan.mqd) ms.insert(plan.mqd);
  if (plan.tps) ts.insert(plan.tps);
  for (const s of plan.skipped) {
    notices.push({
      level: 'info',
      message: s === 'MQD' ? 'MQD app is not active; no MQD created' : 'Third-Party Services app is not active; no TPS created',
    });
  }
  if (plan.transport && args.createTransportJob) {
    try {
      args.createTransportJob(plan.cn);
    } catch (err) {
      notices.push({
        level: 'error',
        message: `Documents created, but the transport job failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  return { ok: true, cn: plan.cn, mqd: plan.mqd, tps: plan.tps, notices };
}

export function refreshReferences(type: DocType, id: string): void {
  const doc =
    type === 'CN'
      ? useCollectionStore.getState().getById(id)
      : type === 'MQD'
        ? useMqdStore.getState().getById(id)
        : useThirdPartyStore.getState().getById(id);
  if (!doc) return;
  const raw = machinesForOrg(doc.orgId).find((m) => m.id === doc.machineId);
  if (!raw) return;
  const machine: MachineLite = {
    orgId: doc.orgId, id: raw.id, fleetNo: raw.fleetNo, assetNumber: raw.assetNumber,
    make: raw.make, model: raw.model, serialNumber: raw.serialNumber,
  };
  const refs = refFieldsOf(resolveReferences(machine, raw.currentCustomer, snapshot(doc.orgId)));
  if (type === 'CN') useCollectionStore.getState().patch(id, refs);
  else if (type === 'MQD') useMqdStore.getState().patch(id, refs);
  else useThirdPartyStore.getState().patch(id, refs);
}

/** Resolves the reference chain for a machine in the current org. Returns undefined if the machine is unknown. */
export function resolveMachineReferences(machineId: string, customerFallback?: string): ReferenceFields | undefined {
  const orgId = currentOrgId();
  try {
    ensureHireLinkDemo(orgId);
  } catch (err) {
    console.error('[collectionDocs]', err);
  }
  const raw = machinesForOrg(orgId).find((m) => m.id === machineId);
  if (!raw) return undefined;
  const machine: MachineLite = {
    orgId, id: raw.id, fleetNo: raw.fleetNo, assetNumber: raw.assetNumber,
    make: raw.make, model: raw.model, serialNumber: raw.serialNumber,
  };
  return refFieldsOf(resolveReferences(machine, customerFallback ?? raw.currentCustomer, snapshot(orgId)));
}

export function listPickerMachines(machines: MachineResolver): MachineLite[] {
  const orgId = currentOrgId();
  return pickerMachines(machines.list(orgId), machines.statusOf);
}

export function resolveQrForCurrentOrg(raw: string, machines: MachineResolver): QrResult {
  const orgId = currentOrgId();
  return resolveQr(raw, orgId, machines.list(orgId));
}

export function resolveFleetQueryForCurrentOrg(
  params: { fleet?: string; id?: string; qr?: string },
  machines: MachineResolver,
): DeepLinkResult | null {
  const orgId = currentOrgId();
  return resolveFleetQuery(params, orgId, machines.list(orgId));
}

export function mergedMqdList(mockList: Inspection[]): MqdRow[] {
  const orgId = currentOrgId();
  const cs = useCollectionStore.getState();
  const persisted: MqdRow[] = useMqdStore
    .getState()
    .forOrg(orgId)
    .map((r) => ({
      id: r.id,
      reference: r.number,
      fleetNo: r.fleetNo,
      hirer: r.hirer,
      collectionNo: (r.cnId ? cs.getById(r.cnId)?.number : undefined) ?? '',
      signedStatus: r.signedStatus,
      persisted: true,
    }));
  const mock: MqdRow[] = mockList.map((i) => ({
    id: i.id,
    reference: i.reference,
    fleetNo: i.assetNumber,
    hirer: '',
    collectionNo: '',
    signedStatus: 'Pending',
    persisted: false,
  }));
  return [...persisted, ...mock];
}

/** Removes a document. Counters are untouched, so its number is never reissued. */
export function deleteDocument(type: DocType, id: string): void {
  if (type === 'CN') useCollectionStore.getState().remove(id);
  else if (type === 'MQD') useMqdStore.getState().remove(id);
  else useThirdPartyStore.getState().remove(id);
}

export function getBundle(cnId: string): { cn?: CollectionNote; mqd?: MqdRecord; tps?: TpsDocument } {
  const cn = useCollectionStore.getState().getById(cnId);
  if (!cn) return {};
  return {
    cn,
    mqd: cn.mqdId ? useMqdStore.getState().getById(cn.mqdId) : undefined,
    tps: cn.tpsId ? useThirdPartyStore.getState().getById(cn.tpsId) : undefined,
  };
}

/** Marks the latest open Collection Note of a machine Collected. Returns the updated note, or undefined if none is open. */
export interface GateLinkRef {
  id: string;
  reference: string;
  timestamp: string;
}

export function markCollectedForMachine(
  orgId: string,
  machineId: string,
  gate: GateLinkRef,
): CollectionNote | undefined {
  const store = useCollectionStore.getState();
  const note = pickNoteToCollect(store.notes, orgId, machineId);
  if (!note) return undefined;
  return store.patch(note.id, {
    status: 'Collected',
    collectedByGateId: gate.id,
    collectedByGateRef: gate.reference,
    collectedAt: gate.timestamp,
    updatedAt: new Date().toISOString(),
  });
}

export function listCollections(): CollectionNote[] {
  return useCollectionStore.getState().forOrg(currentOrgId());
}
export function listThirdParty(): TpsDocument[] {
  return useThirdPartyStore.getState().forOrg(currentOrgId());
}
export function listMqd(): MqdRecord[] {
  return useMqdStore.getState().forOrg(currentOrgId());
}

export function useCollections(): CollectionNote[] {
  const orgId = useAuthStore((s) => s.user?.orgId ?? JA_ORG_ID);
  const notes = useCollectionStore((s) => s.notes);
  return useMemo(() => notes.filter((n) => n.orgId === orgId), [notes, orgId]);
}
export function useThirdPartyDocs(): TpsDocument[] {
  const orgId = useAuthStore((s) => s.user?.orgId ?? JA_ORG_ID);
  const docs = useThirdPartyStore((s) => s.documents);
  return useMemo(() => docs.filter((d) => d.orgId === orgId), [docs, orgId]);
}
export function useMqdRecords(): MqdRecord[] {
  const orgId = useAuthStore((s) => s.user?.orgId ?? JA_ORG_ID);
  const records = useMqdStore((s) => s.records);
  return useMemo(() => records.filter((r) => r.orgId === orgId), [records, orgId]);
}
