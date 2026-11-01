import { BaseEntity, ID } from './common';

export type NotificationType = 'info' | 'success' | 'warning' | 'error' | 'maintenance';
export type NotificationCategory =
  | 'Breakdown'
  | 'Inspection'
  | 'Booking'
  | 'Workshop'
  | 'Transport'
  | 'System'
  | 'Compliance';

export interface AppNotification extends BaseEntity {
  title: string;
  message: string;
  type: NotificationType;
  category: NotificationCategory;
  read: boolean;
  priority: 'Low' | 'Normal' | 'High';
  actionUrl?: string;
  relatedId?: ID;
}
