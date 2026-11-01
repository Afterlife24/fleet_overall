import { BaseEntity } from './common';

export interface Customer extends BaseEntity {
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  city: string;
  country: 'UAE' | 'KSA';
  activeBookings: number;
  totalRevenue: number;
  rating: number;
  status: 'Active' | 'Inactive' | 'Blacklisted';
}
