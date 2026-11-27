export type ID = string;

export type ISODate = string;

export interface BaseEntity {
  id: ID;
  createdAt: ISODate;
  updatedAt: ISODate;
  /** Set on records read from the API; sent back as If-Match on update. */
  rowVersion?: number;
}

export interface TimelineEvent {
  id: ID;
  timestamp: ISODate;
  title: string;
  description?: string;
  actor: string;
  type: 'info' | 'success' | 'warning' | 'error' | 'maintenance';
}

export interface SelectOption {
  label: string;
  value: string;
}
