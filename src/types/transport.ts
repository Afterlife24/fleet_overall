import { BaseEntity, ID, ISODate } from './common';

export interface Driver {
  id: ID;
  name: string;
  phone: string;
  licenseNumber: string;
  licenseExpiry: ISODate;
  branchId: ID;
  branchName: string;
  status: 'Available' | 'On Delivery' | 'Returning' | 'Off Duty';
  rating: number;
  totalDeliveries: number;
  currentTruckId?: ID;
}

export interface Truck {
  id: ID;
  registration: string;
  type: 'Flatbed' | 'Lowboy' | 'Crane Truck' | 'Recovery';
  capacity: number;
  branchId: ID;
  branchName: string;
  status: 'Available' | 'On Route' | 'Maintenance' | 'Offline';
  currentDriverId?: ID;
  currentDriverName?: string;
}

export type TransportJobStatus =
  | 'Scheduled'
  | 'Loading'
  | 'In Transit'
  | 'Delivered'
  | 'Returning'
  | 'Completed';

export interface TransportJob extends BaseEntity {
  reference: string;
  machineId: ID;
  assetNumber: string;
  machineModel: string;
  branchId: ID;
  branchName: string;
  driverId: ID;
  driverName: string;
  truckId: ID;
  truckRegistration: string;
  origin: string;
  destination: string;
  scheduledTime: ISODate;
  status: TransportJobStatus;
  distance: number;
  bookingRef?: string;
  type: 'Delivery' | 'Collection' | 'Transfer';
  notes?: string;
  
  // Financial tracking for TRIPBASE report
  customerName?: string;      // Who's being charged
  chargeToCustomer: number;   // Transport fee charged (ex-VAT)
  internalCost: number;       // Actual cost (fuel + wages + tolls)
}
