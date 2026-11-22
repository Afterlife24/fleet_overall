import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  MAX_SEQUENCE,
  addDays,
  validateInvoiceRemoval,
  validateInvoiceRequest,
  type AgreementLite,
  type InvoiceLite,
  type InvoicingSnapshot,
} from '../../invoiceRulesCore';

const ORG = 'org-a';
const QID = 'q-1';
const QNO = 'QT-2026-0001';
const HIRE_START = '2026-01-01';
const HIRE_END = addDays(HIRE_START, 3000);

const agreement: AgreementLite = {
  id: 'ag-1', orgId: ORG, agreementNo: 'HA-0001', quotationId: QID, status: 'Active',
  hireStartDate: HIRE_START, hireEndDate: HIRE_END,
  customerId: 'c', customerName: 'C', customerTrn: '', attn: '', contactNumber: '', customerEmail: '',
  billingAddress: '', deliveryLocation: '', paymentTerms: '', paymentMethod: '', securityDeposit: 0,
  equipmentName: '', equipmentModel: '', serialNumber: '', workingHeight: '', capacity: '',
  monthlyRental: 0, transportationCharges: 0,
};

function snap(invoices: InvoiceLite[], sequenceByQuotation: Record<string, number>): InvoicingSnapshot {
  return {
    orgId: ORG, today: '2099-12-31', crmActive: true, // after every hire end: Off-Hire is due
    quotations: [{ id: QID, orgId: ORG, number: QNO, phase: 'Won', customerName: 'C', customerId: 'c', amount: 0 }],
    agreements: [agreement],
    invoices,
    sequenceByQuotation,
  };
}

type Op =
  | { kind: 'create'; type: 'Continuous Hire' | 'Off-Hire'; len: number }
  | { kind: 'cancel'; pick: number }
  | { kind: 'delete'; pick: number };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 6, arbitrary: fc.record({ kind: fc.constant('create' as const), type: fc.constant('Continuous Hire' as const), len: fc.integer({ min: 1, max: 20 }) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('create' as const), type: fc.constant('Off-Hire' as const), len: fc.constant(1) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('cancel' as const), pick: fc.nat(1000) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('delete' as const), pick: fc.nat(1000) }) },
);

/** In-memory model of the store: insertLinked bumps the counter by max, remove leaves it alone. */
class Model {
  invoices: InvoiceLite[] = [];
  seq: Record<string, number> = {};
  private n = 0;
  assigned: number[] = [];

  snapshot(): InvoicingSnapshot {
    return snap(this.invoices, this.seq);
  }

  create(type: 'Continuous Hire' | 'Off-Hire', len: number) {
    const s = this.snapshot();
    const r = validateInvoiceRequest(
      s,
      type === 'Continuous Hire'
        ? { quotationId: QID, invoiceType: type, periodEnd: addDays(this.nextStart(), len - 1) }
        : { quotationId: QID, invoiceType: type },
    );
    if (!r.ok) return r;
    const p = r.value;
    this.invoices.push({
      id: `inv-${++this.n}`, orgId: ORG, quotationId: QID, invoiceType: p.invoiceType,
      status: 'Draft', periodStart: p.periodStart, periodEnd: p.periodEnd, sequence: p.sequence,
    });
    this.seq[QID] = Math.max(this.seq[QID] ?? 0, p.sequence);
    this.assigned.push(p.sequence);
    return r;
  }

  private nextStart(): string {
    const active = this.invoices.filter((i) => i.status !== 'Cancelled');
    const ends = active.map((i) => i.periodEnd!).sort();
    return ends.length ? addDays(ends[ends.length - 1], 1) : HIRE_START;
  }

  remove(action: 'cancel' | 'delete', pick: number) {
    if (this.invoices.length === 0) return;
    const target = this.invoices[pick % this.invoices.length];
    if (!validateInvoiceRemoval(this.snapshot(), target.id, action).ok) return;
    if (action === 'cancel') target.status = 'Cancelled';
    else this.invoices = this.invoices.filter((i) => i.id !== target.id);
  }
}

// Feature: won-quotation-invoicing, Property 4: Sequence numbers are strictly increasing and never reused
describe('Property 4: Sequence numbers are strictly increasing and never reused', () => {
  // **Validates: Requirements 3.3, 3.4, 11.3**
  it('each created invoice gets a sequence above every earlier one, across cancels and deletes', () => {
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 1, maxLength: 60 }), (ops) => {
        const m = new Model();
        for (const op of ops) {
          if (op.kind === 'create') {
            const before = Math.max(0, ...m.assigned);
            const r = m.create(op.type, op.len);
            if (r.ok) {
              expect(r.value.sequence).toBeGreaterThan(before);
              expect(r.value.sequence).toBe(before + 1);
              expect(r.value.invoiceNo).toBe(`${QNO}/${String(r.value.sequence).padStart(2, '0')}`);
            }
          } else {
            m.remove(op.kind, op.pick);
          }
        }
        // strictly increasing, therefore never reused
        for (let i = 1; i < m.assigned.length; i++) expect(m.assigned[i]).toBeGreaterThan(m.assigned[i - 1]);
        expect(new Set(m.assigned).size).toBe(m.assigned.length);
      }),
      { numRuns: 200 },
    );
  });

  it('deleting the latest invoice does not make its sequence available again', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), fc.constantFrom<'cancel' | 'delete'>('cancel', 'delete'), (count, action) => {
        const m = new Model();
        for (let i = 0; i < count; i++) expect(m.create('Continuous Hire', 3).ok).toBe(true);
        m.remove(action, count - 1); // latest invoice is the last element
        const r = m.create('Continuous Hire', 3);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.value.sequence).toBe(count + 1);
      }),
      { numRuns: 100 },
    );
  });

  it('fails with SEQUENCE_EXHAUSTED when the highest assigned sequence is 99', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('Continuous Hire', 'Off-Hire'),
        fc.boolean(),
        fc.integer({ min: 1, max: 30 }),
        (type, hasRemainingInvoice, len) => {
          // Counter survives deletes: the highest sequence may belong to a deleted invoice.
          const invoices: InvoiceLite[] = hasRemainingInvoice
            ? [{ id: 'i', orgId: ORG, quotationId: QID, invoiceType: 'Continuous Hire', status: 'Draft',
                periodStart: HIRE_START, periodEnd: addDays(HIRE_START, 4), sequence: MAX_SEQUENCE }]
            : [];
          const start = hasRemainingInvoice ? addDays(HIRE_START, 5) : HIRE_START;
          const r = validateInvoiceRequest(snap(invoices, { [QID]: MAX_SEQUENCE }), {
            quotationId: QID, invoiceType: type, ...(type === 'Continuous Hire' ? { periodEnd: addDays(start, len - 1) } : {}),
          });
          expect(r.ok).toBe(false);
          if (!r.ok) expect(r.code).toBe('SEQUENCE_EXHAUSTED');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('reaches 99 invoices and then refuses the 100th', () => {
    const m = new Model();
    for (let i = 1; i <= MAX_SEQUENCE; i++) {
      const r = m.create('Continuous Hire', 1);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.sequence).toBe(i);
    }
    const r = m.create('Continuous Hire', 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('SEQUENCE_EXHAUSTED');
  });
});
