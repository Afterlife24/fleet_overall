import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { formatInvoiceNo, parseInvoiceNo } from '../../invoiceRulesCore';

// Feature: won-quotation-invoicing, Property 3: Invoice number round trip
// **Validates: Requirements 3.1, 3.2**

const TRAILING_NN = /\/\d{2}$/;

const quotationNumber = fc
  .stringMatching(/^[A-Za-z0-9\-_/ ]{1,24}$/)
  .filter((s) => s.length > 0 && !TRAILING_NN.test(s));

const realisticNumber = fc
  .tuple(fc.integer({ min: 2000, max: 2099 }), fc.integer({ min: 1, max: 9999 }))
  .map(([y, n]) => `QT-${y}-${String(n).padStart(4, '0')}`);

describe('Property 3: Invoice number round trip', () => {
  it('parse(format(number, seq)) returns the same number and sequence', () => {
    fc.assert(
      fc.property(fc.oneof(quotationNumber, realisticNumber), fc.integer({ min: 1, max: 99 }), (qn, seq) => {
        expect(parseInvoiceNo(formatInvoiceNo(qn, seq))).toEqual({ quotationNumber: qn, seq });
      }),
      { numRuns: 200 },
    );
  });

  it('formatted text ends with "/" and the sequence zero-padded to two digits', () => {
    fc.assert(
      fc.property(fc.oneof(quotationNumber, realisticNumber), fc.integer({ min: 1, max: 99 }), (qn, seq) => {
        const text = formatInvoiceNo(qn, seq);
        expect(text.endsWith(`/${String(seq).padStart(2, '0')}`)).toBe(true);
        expect(text.startsWith(qn)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('example: QT-2026-0003 + 1 -> QT-2026-0003/01', () => {
    expect(formatInvoiceNo('QT-2026-0003', 1)).toBe('QT-2026-0003/01');
    expect(parseInvoiceNo('QT-2026-0003/01')).toEqual({ quotationNumber: 'QT-2026-0003', seq: 1 });
  });

  it('returns null when there is no /NN suffix', () => {
    expect(parseInvoiceNo('QT-2026-0003')).toBeNull();
    expect(parseInvoiceNo('QT-2026-0003/1')).toBeNull();
  });
});
