import { BaseEntity, ID, ISODate, TimelineEvent } from './common';

export type BreakdownStatus = 'Open' | 'Assigned' | 'In Progress' | 'Resolved' | 'Closed';

export type BreakdownSeverity = 'Low' | 'Medium' | 'High' | 'Critical';

export interface Breakdown extends BaseEntity {
  reference: string;
  machineId: ID;
  assetNumber: string;
  machineModel: string;
  branchId: ID;
  branchName: string;
  customerName?: string;
  location: string;
  severity: BreakdownSeverity;
  status: BreakdownStatus;
  reportedBy: string;
  reportedAt: ISODate;
  description: string;
  technicianId?: ID;
  technicianName?: string;
  resolvedAt?: ISODate;
  resolution?: string;
  partsUsed?: string[];
  downtimeHours?: number;
  timeline: TimelineEvent[];
  hasDamageClaim: boolean;
}
