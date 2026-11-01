import { BaseEntity, ISODate, TimelineEvent } from './common';

/**
 * Cross Hire (a.k.a. sub-hire / re-hire).
 *
 * The company rents a machine IN from an external supplier at a buy rate, then
 * rents it OUT to its own client at a higher sell rate. The margin between the
 * sell rate and the buy rate is the cross-hire profit.
 *
 * This is used when owned fleet can't cover demand (wrong spec, wrong region,
 * fully utilised) but the commercial opportunity is still worth servicing.
 */

export type CrossHireStatus =
  | 'Enquiry'      // Client wants a machine we don't have — sourcing a supplier
  | 'Confirmed'    // Supplier agreed, PO raised, awaiting delivery
  | 'On Hire'      // Machine on the client site, both legs active
  | 'Off Hire'     // Client requested collection, winding down
  | 'Returned'     // Machine returned to supplier, billing closed
  | 'Cancelled';   // Deal fell through

export type CrossHireCategory =
  | 'Articulating Boom'
  | 'Telescopic Boom'
  | 'Scissor Lift'
  | 'Telehandler'
  | 'Vertical Mast'
  | 'Trailer Mounted'
  | 'Other';

export interface CrossHire extends BaseEntity {
  reference: string;            // CH-2026-0001

  // Machine being cross-hired
  category: CrossHireCategory;
  make: string;
  model: string;
  description: string;          // e.g. "26m Diesel Articulating Boom"
  supplierAssetNumber?: string; // supplier's own fleet number
  serialNumber?: string;

  // Supplier leg (we rent IN)
  supplierName: string;
  supplierContact?: string;
  supplierPhone?: string;
  buyRate: number;              // AED per period we pay the supplier
  supplierPO?: string;          // purchase order raised to supplier

  // Client leg (we rent OUT)
  customerName: string;
  customerContact?: string;
  siteLocation: string;
  sellRate: number;             // AED per period the client pays us
  clientLPO?: string;           // client purchase order

  ratePeriod: 'Day' | 'Week' | 'Month';
  quantity: number;

  branchId: string;
  branchName: string;

  status: CrossHireStatus;
  startDate: ISODate;
  endDate: ISODate;
  expectedReturnDate?: ISODate;

  salesRep: string;
  notes?: string;

  timeline: TimelineEvent[];
}

/** Profit margin per period for a single unit. */
export function crossHireMargin(ch: Pick<CrossHire, 'sellRate' | 'buyRate'>): number {
  return ch.sellRate - ch.buyRate;
}

/** Margin as a percentage of the sell rate. */
export function crossHireMarginPct(ch: Pick<CrossHire, 'sellRate' | 'buyRate'>): number {
  if (!ch.sellRate) return 0;
  return Math.round(((ch.sellRate - ch.buyRate) / ch.sellRate) * 100);
}
