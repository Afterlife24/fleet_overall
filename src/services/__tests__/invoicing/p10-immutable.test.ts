import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  PROTECTED_FIELDS,
  validateInvoiceUpdate,
  type InvoiceLite,
  type ProtectedField,
  type ProtectedFields,
} from '../../invoiceRulesCore';
import type { TaxInvoice } from '@/types/taxinvoice';

// Feature: won-quotation-invoicing, Property 10: Linked invoices keep protected fields, legacy invoices stay editable
// **Validates: Requirements 9.5, 9.6, 9.7, 9.8**

const RUNS = { numRuns: 100 };

const str = fc.string({ minLength: 1, maxLength: 12 });
const protectedValues: Record<ProtectedField, fc.Arbitrary<unknown>> = {
  quotationId: str,
  quotationNumber: str,
  invoiceNo: str,
  sequence: fc.integer({ min: 1, max: 99 }),
  invoiceType: fc.constantFrom('Continuous Hire', 'Off-Hire'),
  periodStart: fc.constantFrom('2026-01-01', '2026-02-01', '2026-03-01'),
  periodEnd: fc.constantFrom('2026-01-31', '2026-02-28', '2026-03-31'),
  hireAgreementId: str,
  orgId: str,
};

const linked = fc.record(protectedValues).map(
  (p) => ({ id: 'inv-1', status: 'Draft', ...p }) as unknown as InvoiceLite & ProtectedFields,
);

const legacy = fc.record({ orgId: str, status: fc.constantFrom('Draft', 'Sent', 'Paid') }).map(
  (p) => ({ id: 'inv-legacy', ...p }) as unknown as InvoiceLite & ProtectedFields,
);

/** Patch touching only fields that are allowed to change. */
const editable = fc.record(
  {
    status: fc.constantFrom('Draft', 'Sent', 'Paid', 'Cancelled'),
    invoiceDate: fc.constantFrom('2026-01-05', '2026-02-05'),
    dueDate: fc.constantFrom('2026-02-05', '2026-03-05'),
    equipmentQty: fc.integer({ min: 0, max: 1000 }),
    equipmentRate: fc.integer({ min: 0, max: 100000 }),
    transportationQty: fc.integer({ min: 0, max: 1000 }),
    transportationRate: fc.integer({ min: 0, max: 100000 }),
    paymentMethod: str,
    securityDeposit: fc.integer({ min: 0, max: 100000 }),
    notes: fc.string(),
  },
  { requiredKeys: [] },
) as fc.Arbitrary<Partial<TaxInvoice>>;

const anyPatch = fc.oneof(
  editable,
  fc.record(protectedValues, { requiredKeys: [] }).map((p) => p as unknown as Partial<TaxInvoice>),
);

describe('Property 10: Linked invoices keep protected fields, legacy invoices stay editable', () => {
  it('rejects with IMMUTABLE_FIELD when a protected field changes to a different value', () => {
    fc.assert(
      fc.property(
        linked,
        editable,
        fc.constantFrom(...PROTECTED_FIELDS),
        str,
        (existing, base, field, suffix) => {
          const current = (existing as ProtectedFields)[field];
          const changed = typeof current === 'number' ? current + 1 : `${String(current)}-${suffix}`;
          const patch = { ...base, [field]: changed } as Partial<TaxInvoice>;
          const r = validateInvoiceUpdate(existing, patch);
          expect(r.ok).toBe(false);
          if (!r.ok) {
            expect(r.code).toBe('IMMUTABLE_FIELD');
            expect(r.message).toContain(field);
          }
        },
      ),
      RUNS,
    );
  });

  it('accepts patches touching only editable fields', () => {
    fc.assert(
      fc.property(linked, editable, (existing, patch) => {
        expect(validateInvoiceUpdate(existing, patch)).toEqual({ ok: true, value: true });
      }),
      RUNS,
    );
  });

  it('accepts patches that restate protected fields with their current values', () => {
    fc.assert(
      fc.property(linked, editable, fc.subarray([...PROTECTED_FIELDS]), (existing, base, fields) => {
        const patch: Record<string, unknown> = { ...base };
        for (const f of fields) patch[f] = (existing as ProtectedFields)[f];
        expect(validateInvoiceUpdate(existing, patch as Partial<TaxInvoice>).ok).toBe(true);
      }),
      RUNS,
    );
  });

  it('outcome matches "some protected field differs" for any patch', () => {
    fc.assert(
      fc.property(linked, anyPatch, (existing, patch) => {
        const p = patch as ProtectedFields;
        const e = existing as ProtectedFields;
        const changes = PROTECTED_FIELDS.some((k) => k in p && p[k] !== e[k]);
        const r = validateInvoiceUpdate(existing, patch);
        expect(r.ok).toBe(!changes);
        if (!r.ok) expect(r.code).toBe('IMMUTABLE_FIELD');
      }),
      RUNS,
    );
  });

  it('accepts any patch for legacy invoices without a quotationId', () => {
    fc.assert(
      fc.property(legacy, anyPatch, (existing, patch) => {
        expect(validateInvoiceUpdate(existing, patch)).toEqual({ ok: true, value: true });
      }),
      RUNS,
    );
  });
});
