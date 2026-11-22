import { BaseEntity, ID, ISODate } from './common';
import type { RefCounters } from '@/services/refCounterCore';

export type GateDirection = 'IN' | 'OUT';
export type GateStatus = 'Pending' | 'Approved' | 'Completed';

export type TimeSource = 'server' | 'device';
export type CaptureMethod = 'QR' | 'Manual';

export interface GateEntry extends BaseEntity {
  reference: string;
  assetNumber: string;
  machineModel: string;
  direction: GateDirection;
  timestamp: ISODate;
  driver: string;
  customer?: string;
  destination: string;
  status: GateStatus;
  branchId: ID;
  branchName: string;
  gatePass: string;
  notes?: string;
  fleetNo?: string;
  gateDate?: string;
  gateTime?: string;
  gateTimeZone?: string;
  captureMethod?: CaptureMethod;
  timeSource?: TimeSource;
  qrPayload?: string;
}

/** A persisted gate record. Always belongs to one company. */
export interface GateRecord extends GateEntry {
  orgId: string;
  machineId?: string;
  truckPlate?: string;
  arrivingFrom?: string;
  /** Set only on Gate_Seed_Records; equals the record id. */
  seedKey?: string;
}

export interface GateStoreState {
  entries: GateRecord[];
  /** orgId -> ids of seed records already created once. */
  seedMarkers: Record<string, string[]>;
  legacyImported: boolean;
  /** Reference counters per company, prefix and year. Optional so v1 persisted state still type-checks. */
  counters?: RefCounters;
}
