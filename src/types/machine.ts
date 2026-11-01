import { BaseEntity, ID, ISODate, TimelineEvent } from './common';
import { Branch } from './branch';

export type MachineCategory =
  | 'Articulating Boom'
  | 'Telescopic Boom'
  | 'Scissor Lift'
  | 'Telehandler'
  | 'Vertical Mast'
  | 'Trailer Mounted';

export type MachineStatus =
  | 'Available'
  | 'Allocated'
  | 'On Hire'
  | 'Under Repair'
  | 'In Workshop'
  | 'PDI'
  | 'PHI'
  | 'Transport'
  | 'Breakdown'
  | 'Offline';

export type PowerSource = 'Diesel' | 'Electric' | 'Hybrid' | 'Bi-Energy';

export interface MachineDocument {
  id: ID;
  name: string;
  type: 'Registration' | 'Insurance' | 'Certificate' | 'Manual' | 'Permit';
  uploadedAt: ISODate;
  expiryDate?: ISODate;
  size: string;
}

export interface RepairRecord {
  id: ID;
  date: ISODate;
  description: string;
  technician: string;
  cost: number;
  bay: string;
  durationHours: number;
}

export interface Machine extends BaseEntity {
  assetNumber: string;
  serialNumber: string;
  make: string;
  model: string;
  category: MachineCategory;
  status: MachineStatus;
  branchId: ID;
  branchName: string;
  powerSource: PowerSource;
  platformHeight: number;
  workingHeight: number;
  capacity: number;
  year: number;
  hoursOperated: number;
  lastInspection: ISODate;
  nextInspection: ISODate;
  nextPHI: ISODate;
  nextMandatory: ISODate;
  location: string;
  currentCustomer?: string;
  currentBookingId?: ID;
  documents: MachineDocument[];
  repairHistory: RepairRecord[];
  timeline: TimelineEvent[];

  // ── TPC (Third Party Certification) — mandatory UAE safety cert, expires every 6 months ──
  tpcExpiryDate?: ISODate;   // date the current TPC certificate expires
  tpcSupplier?: string;      // government-approved certifying company
}

export interface MachineCategoryInfo {
  name: MachineCategory;
  count: number;
  icon: string;
}
