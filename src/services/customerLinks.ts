// Facade: the quotations, hire agreements and invoices that carry one customer's customerId.
import { useMemo } from 'react';
import { useCrmStore } from '@/store/crmStore';
import { useHireAgreementStore } from '@/store/hireAgreementStore';
import { useTaxInvoiceStore } from '@/store/taxInvoiceStore';
import { linksForCustomer } from './customerCore';

/** Live links of one customer of one company. Empty lists while the ids are unknown. */
export function useCustomerLinks(orgId: string | undefined, customerId: string | undefined) {
  const quotations = useCrmStore((s) => s.quotations);
  const agreements = useHireAgreementStore((s) => s.agreements);
  const invoices = useTaxInvoiceStore((s) => s.invoices);
  return useMemo(
    () =>
      orgId && customerId
        ? linksForCustomer({ quotations, agreements, invoices }, orgId, customerId)
        : { quotations: [], agreements: [], invoices: [] },
    [orgId, customerId, quotations, agreements, invoices],
  );
}
