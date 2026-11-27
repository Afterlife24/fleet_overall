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
  /** Owning organisation; absent on legacy records. */
  orgId?: string;
  /** Hire Agreement id; absent when unlinked. */
  hireAgreementId?: string;
  // Fields below come from the bookings API (absent on records built elsewhere).
  agreementNo?: string;
  fleetNo?: string;
  lpoId?: string;
  quoted?: boolean;
  haSent?: boolean;
  haReceived?: boolean;
  reserved?: boolean;
  onHireAt?: string | null;
  departedAt?: string | null;
  offHireRequestedAt?: string | null;
  collectedAt?: string | null;
  /** Set by the server when the machine came back; the only source of the Returned state. */
  returnedAt?: string | null;
  physicallyOccupied?: boolean;
}
