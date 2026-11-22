import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  addDays,
  validateInvoiceRemoval,
  type InvoiceLite,
  type InvoicingSnapshot,
} from '../../invoiceRulesCore';

// Feature: won-quotation-invoicing, Property 11: Only the latest active linked invoice can be deleted or cancelled
// **Validates: Requirements 11.1, 11.2, 11.4**

const BASE = '2000-01-01';
const ORG = 'org-1';
const QID = 'q-1';

function snapshot(invoices: InvoiceLite[]): InvoicingSnapshot {
  return {
    orgId: ORG, today: BASE, crmActive: true,
    quotations: [], agreements: [], invoices,
    sequenceByQuotation: {},
  };
}

/** Contiguous chain of linked active invoices, shuffled; period ends strictly increase with sequence. */
const chain: fc.Arbitrary<InvoiceLite[]> = fc
  .record({
    startOffset: fc.integer({ min: 0, max: 40000 }),
    spans: fc.array(fc.integer({ min: 1, max: 60 }), { minLength: 1, maxLength: 8 }),
  })
  .chain(({ startOffset, spans }) => {
    let cursor = addDays(BASE, startOffset);
    const invoices: InvoiceLite[] = spans.map((span, i) => {
      const periodStart = cursor;
      const periodEnd = addDays(periodStart, span - 1);
      cursor = addDays(periodEnd, 1);
      return {
        id: `inv-${i + 1}`, orgId: ORG, quotationId: QID, invoiceType: 'Continuous Hire',
        status: 'Draft', periodStart, periodEnd, sequence: i + 1,
      };
    });
    return fc.shuffledSubarray(invoices, { minLength: invoices.length, maxLength: invoices.length });
  });

const action = fc.constantFrom<'delete' | 'cancel'>('delete', 'cancel');

describe('Property 11: removal control', () => {
  it('succeeds exactly for the active invoice with the latest periodEnd', () => {
    fc.assert(
      fc.property(chain, fc.nat(), action, (invoices, pick, act) => {
        const chosen = invoices[pick % invoices.length];
        const latestEnd = invoices.reduce((m, i) => (i.periodEnd! > m ? i.periodEnd! : m), '');
        const r = validateInvoiceRemoval(snapshot(invoices), chosen.id, act);
        if (chosen.periodEnd === latestEnd) {
          expect(r.ok).toBe(true);
        } else {
          expect(r.ok).toBe(false);
          if (!r.ok) expect(r.code).toBe('NOT_LATEST_INVOICE');
        }
      }),
      { numRuns: 100 },
    );
  });

  it('ignores Cancelled invoices of the quotation when finding the latest', () => {
    fc.assert(
      fc.property(chain, action, (invoices, act) => {
        const sorted = [...invoices].sort((a, b) => a.periodEnd!.localeCompare(b.periodEnd!));
        const last = sorted[sorted.length - 1];
        const extra: InvoiceLite = {
          id: 'inv-cancelled', orgId: ORG, quotationId: QID, invoiceType: 'Continuous Hire',
          status: 'Cancelled', periodStart: addDays(last.periodEnd!, 1),
          periodEnd: addDays(last.periodEnd!, 30), sequence: 99,
        };
        const r = validateInvoiceRemoval(snapshot([...invoices, extra]), last.id, act);
        expect(r.ok).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('always succeeds for legacy invoices without a quotationId', () => {
    fc.assert(
      fc.property(chain, action, fc.boolean(), (linked, act, hasDates) => {
        const legacy: InvoiceLite = {
          id: 'legacy-1', orgId: ORG, status: 'Draft',
          ...(hasDates ? { periodStart: BASE, periodEnd: BASE } : {}),
        };
        const r = validateInvoiceRemoval(snapshot([...linked, legacy]), legacy.id, act);
        expect(r.ok).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
