import type { Machine } from '@/types/machine';
import type { MachineLite } from '@/services/collectionCore';
import type { MachineResolver } from '@/services/collectionDocs';

export const toMachineLite = (m: Machine, orgId: string): MachineLite => ({
  orgId,
  id: m.id,
  fleetNo: m.fleetNo,
  assetNumber: m.assetNumber,
  make: m.make,
  model: m.model,
  serialNumber: m.serialNumber,
});

/**
 * Machine resolver for QR / deep-link lookups over the machines read from `/api/v1/machines`
 * (the Fleet screen's `useFleetMachines`). Collection itself starts from a booking (see `InitiateDialog`).
 */
export function machineResolverFor(machines: readonly Machine[]): MachineResolver {
  return {
    list: (orgId) => machines.map((m) => toMachineLite(m, orgId)),
    statusOf: (id) => machines.find((m) => m.id === id)?.status ?? '',
  };
}