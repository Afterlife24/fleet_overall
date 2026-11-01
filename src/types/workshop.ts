import { BaseEntity, ID, ISODate, TimelineEvent } from './common';

export type WorkshopStatus =
  | 'Waiting Parts'
  | 'Waiting Mechanic'
  | 'Under Repair'
  | 'Work In Progress'
  | 'PDI'
  | 'Available'
  | 'Quality Check';

export type Priority = 'Low' | 'Medium' | 'High' | 'Critical';

export interface Technician {
  id: ID;
  name: string;
  role: string;
  branchId: ID;
  branchName: string;
  specialization: string;
  status: 'Available' | 'Assigned' | 'On Leave';
  avatarColor: string;
  activeJobs: number;
  completedJobs: number;
  rating: number;
}

export interface WorkshopBay {
  id: ID;
  name: string;
  branchId: ID;
  status: 'Occupied' | 'Available' | 'Maintenance';
  currentJobId?: ID;
  machineAsset?: string;
}

export interface WorkshopJob extends BaseEntity {
  reference: string;
  machineId: ID;
  assetNumber: string;
  machineModel: string;
  branchId: ID;
  branchName: string;
  status: WorkshopStatus;
  priority: Priority;
  technicianId?: ID;
  technicianName?: string;
  bayId?: ID;
  bayName?: string;
  description: string;
  estimatedHours: number;
  actualHours?: number;
  partsRequired: string[];
  scheduledDate: ISODate;
  completedDate?: ISODate;
  timeline: TimelineEvent[];
}
