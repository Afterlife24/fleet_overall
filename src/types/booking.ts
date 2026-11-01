import { BaseEntity, ID, ISODate } from './common';

export type BookingStatus =
  | 'Draft'
  | 'Reserved'
  | 'Pending Approval'
  | 'Approved'
  | 'Allocated'
  | 'On Hire'
  | 'Returned'
  | 'Cancelled';

export interface Booking extends BaseEntity {
  reference: string;
  customerId: ID;
  customerName: string;
  machineId: ID;
  assetNumber: string;
  machineModel: string;
  branchId: ID;
  branchName: string;
  startDate: ISODate;
  endDate: ISODate;
  status: BookingStatus;
  deliveryAddress: string;
  contactPhone: string;
  operatorRequired: boolean;
  dailyRate: number;
  totalValue: number;
  notes?: string;
}
