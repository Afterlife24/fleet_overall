import type { BaseEntity, ISODate } from './common';

export type QuotationPhase = 'Awaiting' | 'Tender' | 'Lost' | 'Won';
export const PHASES: readonly QuotationPhase[] = ['Awaiting', 'Tender', 'Lost', 'Won'];

export interface PhaseHistoryEntry {
  id: string;
  timestamp: ISODate;
  user: string;
  /** null for the creation entry */
  fromPhase: QuotationPhase | null;
  toPhase: QuotationPhase;
  /** Lost reason or reopen reason */
  reason?: string;
}

export interface Quotation extends BaseEntity {
  orgId: string;
  number: string;
  /** Opportunity title, e.g. "ABC Company - Boom Lift Hire" */
  opportunity: string;
  /** One per company. A repeat quotation from the same company reuses it. */
  hireAgreementNo: string;
  email?: string;
  customerId: string;
  customerName: string;
  amount: number;
  currency: string;
  phase: QuotationPhase;
  lostReason?: string;
  lostAt?: ISODate;
  lostBy?: string;
  salesRep?: string;
  validUntil?: ISODate;
  notes?: string;
  history: PhaseHistoryEntry[];
}

export type QuotationDraft = Pick<Quotation, 'opportunity' | 'customerName' | 'amount'> &
  Partial<Pick<Quotation, 'customerId' | 'hireAgreementNo' | 'email' | 'currency' | 'salesRep' | 'validUntil' | 'notes'>>;

export const DEFAULT_LOST_REASONS = [
  'Price too high',
  'Competitor chosen',
  'Project cancelled',
  'No response',
  'Other',
] as const;
