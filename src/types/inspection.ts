import { BaseEntity, ID, ISODate, TimelineEvent } from './common';

export type InspectionType = 'PHI' | 'PDI' | 'Mandatory' | 'MQD';

export type InspectionStatus = 'Pending' | 'In Progress' | 'Passed' | 'Failed' | 'Awaiting Approval';

export interface ChecklistItem {
  id: ID;
  section: string;
  question: string;
  result: 'Pass' | 'Fail' | 'N/A' | 'Pending';
  notes?: string;
  critical: boolean;
}

export interface Inspection extends BaseEntity {
  reference: string;
  type: InspectionType;
  machineId: ID;
  assetNumber: string;
  machineModel: string;
  branchId: ID;
  branchName: string;
  inspectorId?: ID;
  inspectorName?: string;
  status: InspectionStatus;
  scheduledDate: ISODate;
  completedDate?: ISODate;
  overallResult?: 'Pass' | 'Fail';
  checklist: ChecklistItem[];
  photoCount: number;
  notes?: string;
  timeline: TimelineEvent[];
}

export interface InspectionSection {
  name: string;
  items: string[];
}
