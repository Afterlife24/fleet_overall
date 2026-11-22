import type { Machine } from '@/types/machine';
import type { MachineLite } from '@/services/collectionCore';
import type { MachineResolver, TransportJobCallback } from '@/services/collectionDocs';
import { useAppStore } from '@/store/appStore';
import { useTransportStore } from '@/store/transportStore';
import { transportJobFromCollection } from '@/services/transportCore';
import { machinesForOrg } from '@/services/mock/orgData';

export const toMachineLite = (m: Machine, orgId: string): MachineLite => ({
  orgId,
  id: m.id,
  fleetNo: m.fleetNo,
  assetNumber: m.assetNumber,
  make: m.make,
  model: m.model,
  serialNumber: m.serialNumber,
});

/** Machine resolver backed by the app store / mock org data. */
export const appMachineResolver: MachineResolver = {
  list: (orgId) => machinesForOrg(orgId).map((m) => toMachineLite(m, orgId)),
  statusOf: (id) => useAppStore.getState().getMachineCurrentStatus(id),
};

/** Writes the collection-generated job to the company's transport store with a fresh TJ- reference. */
export const appCreateTransportJob: TransportJobCallback = (cn) => {
  const store = useTransportStore.getState();
  const now = new Date();
  const ref = store.issueRef(cn.orgId, now.getFullYear());
  const machine = machinesForOrg(cn.orgId).find((m) => m.id === cn.machineId);
  store.add(transportJobFromCollection(cn, ref, `tj-${cn.id}`, now.toISOString(), machine));
};