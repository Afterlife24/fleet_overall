import { BaseEntity, ID } from './common';

export type UserRole = 'Administrator' | 'Branch Manager' | 'Fleet Coordinator' | 'Workshop Manager' | 'Inspector' | 'Driver' | 'Operator';

export type Permission =
  | 'fleet.view'
  | 'fleet.edit'
  | 'bookings.manage'
  | 'workshop.manage'
  | 'transport.manage'
  | 'inspections.conduct'
  | 'reports.view'
  | 'users.manage'
  | 'settings.manage';

export interface User extends BaseEntity {
  name: string;
  email: string;
  phone: string;
  role: UserRole;
  branchId: ID;
  branchName: string;
  status: 'Active' | 'Inactive' | 'Suspended';
  avatarColor: string;
  lastActive: string;
  permissions: Permission[];
}
