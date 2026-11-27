import { useMemo } from 'react';
import { JA_ORG_ID, useAuthStore } from '@/store/authStore';
import { useCollectionStore } from '@/store/collectionStore';
import { useMqdStore } from '@/store/mqdStore';
import { useThirdPartyStore } from '@/store/thirdPartyStore';
import {
  pickNoteToCollect,
  pickerMachines,
  resolveFleetQuery,
  resolveQr,
  type DeepLinkResult,
  type InitiateError,
  type MachineLite,
  type QrResult,
} from '@/services/collectionCore';
import type { CollectionNote, MqdRecord, SignedStatus, TpsDocument } from '@/types/collection';
import type { Inspection } from '@/types/inspection';

// Collection notes, MQD and Third-Party Services documents are owned by the API (`hooks/api/useCollectionApi.ts`).
// The helpers below read the non-persisted in-memory copies those hooks keep up to date.

export type MachineResolver = {
  list(orgId: string): MachineLite[];
  statusOf(machineId: string): string;
};

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

export function getBundle(cnId: string): { cn?: CollectionNote; mqd?: MqdRecord; tps?: TpsDocument } {
  const cn = useCollectionStore.getState().getById(cnId);
  if (!cn) return {};
  return {
    cn,
    mqd: cn.mqdId ? useMqdStore.getState().getById(cn.mqdId) : undefined,
    tps: cn.tpsId ? useThirdPartyStore.getState().getById(cn.tpsId) : undefined,
  };
}

export interface GateLinkRef {
  id: string;
  reference: string;
  timestamp: string;
}

/**
 * Marks the latest open Collection Note of a machine Collected in the in-memory copy only. The backend sets
 * Collected when the gate-in is recorded; this keeps retained readers in step until the next refresh.
 */
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
