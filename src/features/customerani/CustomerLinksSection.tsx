import { SectionTitle } from '@/components/common/InfoGrid';
import { useAuthStore, JA_ORG_ID } from '@/store/authStore';
import { useCustomerLinks } from '@/services/customerLinks';
import { formatCurrency } from '@/utils/format';

function LinkList({ title, rows }: { title: string; rows: { id: string; label: string; detail: string }[] }) {
  return (
    <section data-testid={`customer-links-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <SectionTitle>{title}</SectionTitle>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">None</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between rounded-md border border-border px-3 py-1.5 text-xs">
              <span className="font-mono font-semibold text-foreground">{r.label}</span>
              <span className="text-muted-foreground">{r.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Quotations, hire agreements and invoices linked to a customer by customerId. */
export function CustomerLinksSection({ customerId }: { customerId: string }) {
  const orgId = useAuthStore((s) => s.user?.orgId) ?? JA_ORG_ID;
  const links = useCustomerLinks(orgId, customerId);
  return (
    <>
      <LinkList
        title="Quotations"
        rows={links.quotations.map((q) => ({
          id: q.id, label: q.number, detail: `${q.phase} · ${formatCurrency(q.amount)}`,
        }))}
      />
      <LinkList
        title="Hire agreements"
        rows={links.agreements.map((a) => ({ id: a.id, label: a.agreementNo, detail: a.status }))}
      />
      <LinkList
        title="Invoices"
        rows={links.invoices.map((i) => ({ id: i.id, label: i.invoiceNo, detail: `${i.status} · ${formatCurrency(i.totalAmount)}` }))}
      />
    </>
  );
}
