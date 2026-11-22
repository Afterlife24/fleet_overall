/**
 * Customer (formerly ANI) — full customer master record.
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
  /** Attention / Contact Person name */
  attn?: string;
  address: string;
  /** Customer email */
  email?: string;
  /** Billing address (may differ from main address) */
  billingAddress?: string;
  /** Agreed Total Trade Limit (credit ceiling) in AED */
  attl: number;
  contactNumber: string;
  status: CustomerANIStatus;
  branchName: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/** A Customer_Registry row: a Customer ANI record owned by one company. */
export type CustomerRecord = CustomerANI & { orgId: string };
