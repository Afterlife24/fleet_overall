export type HireAgreementStatus = 'Draft' | 'Active' | 'Completed' | 'Cancelled';

export interface HireAgreement {
  id: string;
  agreementNo: string;
  date: string;
  status: HireAgreementStatus;
  // Lessor (company) — auto-filled from org profile
  lessorName: string;
  lessorTradeLicense: string;
  lessorTrn: string;
  lessorAddress: string;
  lessorPhone: string;
  lessorEmail: string;
  // Hirer (customer)
  customerId: string;
  customerName: string;
  customerTrn: string;
  attn: string;
  contactPerson: string;
  contactNumber: string;
  customerEmail: string;
  billingAddress: string;
  // Equipment
  equipmentName: string;
  equipmentModel: string;
  serialNumber: string;
  quantity: number;
  capacity: string;
  workingHeight: string;
  deliveryLocation: string;
  hireStartDate: string;
  hireEndDate: string;
  hireDuration: string;
  // Charges
  monthlyRental: number;
  transportationCharges: number;
  subtotal: number;
  vat: number;
  totalAmount: number;
  paymentTerms: string;
  securityDeposit: number;
  paymentMethod: string;

  createdAt: string;
  updatedAt: string;
}
