import type { GatePassDto, GatePurpose } from './gate';
import type { GateRecord } from '@/types/gate';

export const PURPOSE_LABEL: Record<GatePurpose, string> = {
  CUSTOMER_HIRE: 'Customer hire (out)',
  CUSTOMER_RETURN: 'Customer return (in)',
  TRANSFER: 'Transfer',
};

export interface GatePassViewContext {
  orgId: string;
  assetNumber?: string;
  machineModel?: string;
  branchName?: string;
  customer?: string;
  timeZone?: string;
}

/**
 * The shape the browser PDF and the pure gate helpers read. Built from the server pass on demand; it is not stored.
 * `timestamp` is the movement time when the pass was completed, otherwise the request time.
 */
export function gateRecordFromDto(p: GatePassDto, ctx: GatePassViewContext): GateRecord {
  const fleetNo = p.fleetNoSnapshot;
  return {
    id: p.id,
    orgId: ctx.orgId,
    reference: p.reference,
    assetNumber: ctx.assetNumber ?? fleetNo,
    fleetNo,
    machineId: p.machineId,
    machineModel: ctx.machineModel ?? '',
    direction: p.direction,
    timestamp: p.movement?.occurredAt ?? p.requestedAt,
    driver: p.driverName,
    customer: ctx.customer,
    destination: p.destination,
    status: p.status,
    branchId: p.branchId,
    branchName: ctx.branchName ?? '',
    gatePass: p.reference,
    notes: p.notes ?? undefined,
    truckPlate: p.truckPlate ?? undefined,
    arrivingFrom: p.arrivingFrom ?? undefined,
    gateTimeZone: ctx.timeZone,
    captureMethod: p.captureMethod,
    timeSource: p.movement ? (p.movement.timeSource === 'DEVICE' ? 'device' : 'server') : undefined,
    qrPayload: p.qrPayload ?? undefined,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    rowVersion: p.rowVersion,
  };
}
