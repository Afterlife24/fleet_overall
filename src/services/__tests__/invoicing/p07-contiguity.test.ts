import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  addDays,
  activeInvoices,
  validateInvoiceRemoval,
  validateInvoiceRequest,
  type AgreementLite,
  type InvoiceLite,
  type InvoicingSnapshot,
} from '../../invoiceRulesCore';

const ORG = 'org-a';
const QID = 'q-1';
const BASE = '2026-01-01';

const agreement: Omit<AgreementLite, 'hireStartDate' | 'hireEndDate'> = {
  id: 'ag-1', orgId: ORG, agreementNo: 'HA-0001', quotationId: QID, status: 'Active',
  customerId: 'c', customerName: 'C', customerTrn: '', attn: '', contactNumber: '', customerEmail: '',
  billingAddress: '', deliveryLocation: '', paymentTerms: '', paymentMethod: '', securityDeposit: 0,
  equipmentName: '', equipmentModel: '', serialNumber: '', workingHeight: '', capacity: '',
  monthlyRental: 0, transportationCharges: 0,
};

function snap(hireEnd: string, invoices: InvoiceLite[], seq: number): InvoicingSnapshot {
  return {
    orgId: ORG, today: '2099-12-31', crmActive: true, // after every hire end: Off-Hire is due
    quotations: [{ id: QID, orgId: ORG, number: 'QT-2026-0001', phase: 'Won', customerName: 'C', customerId: 'c', amount: 0 }],
    agreements: [{ ...agreement, hireStartDate: BASE, hireEndDate: hireEnd }],
    invoices,
    sequenceByQuotation: seq > 0 ? { [QID]: seq } : {},
  };
}

type Op =
  | { kind: 'create'; off: boolean; len: number }
  | { kind: 'remove'; del: boolean };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('create' as const), off: fc.boolean(), len: fc.integer({ min: 1, max: 60 }) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('remove' as const), del: fc.boolean() }) },
);

const REJECT_CODES = ['DUPLICATE_PERIOD', 'OVERLAP', 'GAP'];

function assertContiguous(s: InvoicingSnapshot, hireEnd: string): void {
  const active = activeInvoices(s, QID).sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  active.forEach((inv, i) => {
    expect(inv.periodStart! <= inv.periodEnd!).toBe(true);
    expect(inv.periodStart! >= BASE).toBe(true);
    expect(inv.periodEnd! <= hireEnd).toBe(true);
    if (i === 0) expect(inv.periodStart).toBe(BASE);
    else expect(inv.periodStart).toBe(addDays(active[i - 1].periodEnd!, 1));
  });
}

// Feature: won-quotation-invoicing, Property 7: Active billing periods stay contiguous and within the hire dates
describe('Property 7: Active billing periods stay contiguous and within the hire dates', () => {
  // **Validates: Requirements 6.5, 6.6, 6.7, 6.8**
  it('keeps active periods contiguous across accepted creates and latest-only cancel/delete', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 400 }), fc.array(opArb, { maxLength: 25 }), (span, ops) => {
        const hireEnd = addDays(BASE, span);
        let invoices: InvoiceLite[] = [];
        let seq = 0;

        for (const op of ops) {
          const s = snap(hireEnd, invoices, seq);
          const active = activeInvoices(s, QID);

          if (op.kind === 'create') {
            const hasOff = active.some((i) => i.invoiceType === 'Off-Hire');
            const start = active.length
              ? addDays(active.map((i) => i.periodEnd!).sort().at(-1)!, 1)
              : BASE;
            const periodEnd = op.off ? undefined : (addDays(start, op.len - 1) > hireEnd ? hireEnd : addDays(start, op.len - 1));
            const r = validateInvoiceRequest(s, {
              quotationId: QID, invoiceType: op.off ? 'Off-Hire' : 'Continuous Hire', periodEnd,
            });
            if (hasOff || start > hireEnd) {
              expect(r.ok).toBe(false);
            } else {
              expect(r.ok).toBe(true);
              if (r.ok) {
                expect(r.value.periodStart).toBe(start);
                seq = r.value.sequence;
                invoices = [...invoices, {
                  id: `inv-${seq}`, orgId: ORG, quotationId: QID, invoiceType: r.value.invoiceType,
                  status: 'Draft', periodStart: r.value.periodStart, periodEnd: r.value.periodEnd, sequence: seq,
                }];
              }
            }
          } else if (active.length) {
            const sorted = [...active].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
            const latest = sorted[sorted.length - 1];
            // Non-latest removal is refused.
            for (const other of sorted.slice(0, -1)) {
              const bad = validateInvoiceRemoval(s, other.id, op.del ? 'delete' : 'cancel');
              expect(bad.ok).toBe(false);
              if (!bad.ok) expect(bad.code).toBe('NOT_LATEST_INVOICE');
            }
            const ok = validateInvoiceRemoval(s, latest.id, op.del ? 'delete' : 'cancel');
            expect(ok.ok).toBe(true);
            invoices = op.del
              ? invoices.filter((i) => i.id !== latest.id)
              : invoices.map((i) => (i.id === latest.id ? { ...i, status: 'Cancelled' as const } : i));
          }

          assertContiguous(snap(hireEnd, invoices, seq), hireEnd);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('rejects any request repeating, overlapping or skipping past an existing active period', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 30, max: 400 }),
        fc.array(fc.integer({ min: 1, max: 30 }), { minLength: 1, maxLength: 6 }),
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 1, max: 20 }),
        (span, lens, pick, gapDays) => {
          const hireEnd = addDays(BASE, span);
          const invoices: InvoiceLite[] = [];
          let start = BASE;
          for (const len of lens) {
            if (start > hireEnd) break;
            let end = addDays(start, len - 1);
            if (end > hireEnd) end = hireEnd;
            invoices.push({
              id: `inv-${invoices.length + 1}`, orgId: ORG, quotationId: QID, invoiceType: 'Continuous Hire',
              status: 'Draft', periodStart: start, periodEnd: end, sequence: invoices.length + 1,
            });
            start = addDays(end, 1);
          }
          const s = snap(hireEnd, invoices, invoices.length);
          const target = invoices[pick % invoices.length];

          // Repeat an existing period exactly.
          const dup = validateInvoiceRequest(s, {
            quotationId: QID, invoiceType: 'Continuous Hire',
            periodStart: target.periodStart, periodEnd: target.periodEnd,
          });
          expect(dup.ok).toBe(false);

          if (start <= hireEnd) {
            // Reachable validation: must be one of the contiguity codes.
            if (!dup.ok) expect(REJECT_CODES).toContain(dup.code);
            // Start after the derived start leaves a gap.
            const gapStart = addDays(start, gapDays);
            const gap = validateInvoiceRequest(s, {
              quotationId: QID, invoiceType: 'Continuous Hire', periodStart: gapStart, periodEnd: hireEnd,
            });
            expect(gap.ok).toBe(false);
            if (!gap.ok) expect(gap.code).toBe('GAP');
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
