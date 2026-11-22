// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { migrateTaxInvoiceState } from '../taxInvoiceStore';

// Feature: won-quotation-invoicing, Property 12: Store migration is total and preserves rows
// **Validates: Requirements 11.1, 11.2, 11.4**

const idArb = fc.stringMatching(/^[a-z0-9]{1,8}$/);

const rowArb = fc.record(
  {
    id: idArb,
    orgId: fc.option(idArb, { nil: undefined }),
    quotationId: fc.option(fc.constantFrom('q1', 'q2', 'q3'), { nil: undefined }),
    sequence: fc.option(fc.integer({ min: 1, max: 99 }), { nil: undefined }),
  },
  { requiredKeys: ['id'] }
);

describe('Property 12: migrateTaxInvoiceState', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('is total and returns well-formed state for arbitrary JSON', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const out = migrateTaxInvoiceState(value);
        expect(Array.isArray(out.invoices)).toBe(true);
        expect(Array.isArray(out.seededOrgs)).toBe(true);
        expect(Array.isArray(out.demoLinkedOrgs)).toBe(true);
        for (const inv of out.invoices) expect(typeof inv.orgId).toBe('string');
        const v = value as { invoices?: unknown } | null;
        if (!v || typeof v !== 'object' || !Array.isArray(v.invoices)) {
          expect(out).toEqual({
            invoices: [],
            seededOrgs: [],
            demoLinkedOrgs: [],
            sequenceByQuotation: {},
          });
        }
      }),
      { numRuns: 100 }
    );
  });

  it('keeps every valid row id and sets orgId; sequences are >= stored max per quotation', () => {
    fc.assert(
      fc.property(
        fc.array(rowArb, { maxLength: 15 }),
        fc.dictionary(fc.constantFrom('q1', 'q2', 'q3'), fc.integer({ min: 0, max: 99 })),
        fc.array(fc.jsonValue(), { maxLength: 5 }),
        (rows, storedSeq, junk) => {
          const out = migrateTaxInvoiceState({
            invoices: [...rows, ...junk.filter((j) => typeof j !== 'object' || j === null)],
            sequenceByQuotation: storedSeq,
          });
          expect(out.invoices.map((r) => r.id)).toEqual(rows.map((r) => r.id));
          for (const inv of out.invoices) expect(typeof inv.orgId).toBe('string');
          for (const q of ['q1', 'q2', 'q3']) {
            const seqs = rows
              .filter((r) => r.quotationId === q && r.sequence !== undefined)
              .map((r) => r.sequence as number);
            const expectedMin = Math.max(0, ...seqs, storedSeq[q] ?? 0);
            if (seqs.length > 0 || storedSeq[q] !== undefined) {
              expect(out.sequenceByQuotation[q]).toBeGreaterThanOrEqual(expectedMin);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('resets to empty state when invoices is not an array', () => {
    expect(migrateTaxInvoiceState({ invoices: 'x' })).toEqual({
      invoices: [],
      seededOrgs: [],
      demoLinkedOrgs: [],
      sequenceByQuotation: {},
    });
    expect(migrateTaxInvoiceState(null).invoices).toEqual([]);
  });
});
