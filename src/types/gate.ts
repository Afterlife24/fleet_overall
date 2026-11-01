import { BaseEntity, ID, ISODate } from './common';

export type GateDirection = 'IN' | 'OUT';
export type GateStatus = 'Pending' | 'Approved' | 'Completed';

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
}
