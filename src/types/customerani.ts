/**
 * Customer ANI (Account & Network Integration) — a full customer master record.
 *
 * Fields (per spec):
 *  - Fleet Log ID (auto-generated reference)
 *  - Customer ANI Plugin
 *  - Activate ANI Ravali flag
 *  - Customer ID
 *  - Customer Name
 *  - TRN (Tax Registration Number)
 *  - Address
 *  - ATTL (Agreed Total Trade Limit / credit ceiling)
 *  - Contact Number
 */

export type CustomerANIStatus = 'Active' | 'Inactive' | 'Suspended';

export interface CustomerANI {
  id: string;
  /** Auto-generated Fleet Log reference, e.g. "FL-00042" */
  fleetLogId: string;
  /** Whether the ANI Ravali integration is activated for this customer */
  aniRavaliActive: boolean;
  /** Business customer ID / account code */
  customerId: string;
  customerName: string;
  /** Tax Registration Number */
  trn: string;
  address: string;
  /** Agreed Total Trade Limit (credit ceiling) in AED */
  attl: number;
  contactNumber: string;
  status: CustomerANIStatus;
  branchName: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}
