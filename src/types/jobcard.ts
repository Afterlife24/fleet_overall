import { BaseEntity, ID, ISODate, TimelineEvent } from './common';

export type JobCardStatus = 'Open' | 'Assigned' | 'In Progress' | 'On Hold' | 'Completed' | 'Closed';

export interface JobCardItem {
  id: ID;
  description: string;
  quantity: number;
  unitCost: number;
  total: number;
}

export interface JobCard extends BaseEntity {
  reference: string;
  machineId: ID;
  assetNumber: string;
  machineModel: string;
  branchId: ID;
  branchName: string;
  status: JobCardStatus;
  technicianId?: ID;
  technicianName?: string;
  openedAt: ISODate;
  closedAt?: ISODate;
  laborHours: number;
  laborCost: number;
  items: JobCardItem[];
  totalCost: number;
  description: string;
  timeline: TimelineEvent[];
}
