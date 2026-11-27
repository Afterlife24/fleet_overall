import { describe, expect, it } from 'vitest';
import { checkTransition, PHASES } from '../../src/modules/quotations/transitions.js';
import { computeTotals } from '../../src/modules/hireAgreements/index.js';

describe('checkTransition', () => {
  it('allows exactly the six manual pairs', () => {
    const ok: string[] = [];
    for (const from of PHASES) {
      for (const to of PHASES) {
        const r = checkTransition({ from, to, reason: 'why', hasReopenPermission: true });
        if (r.ok) ok.push(`${from}>${to}`);
        else expect(r.code).toBe('INVALID_TRANSITION');
      }
    }
    expect(ok.sort()).toEqual(
      ['AWAITING>LOST', 'AWAITING>TENDER', 'AWAITING>WON', 'LOST>AWAITING', 'TENDER>LOST', 'TENDER>WON'].sort(),
    );
  });

  it('allows AWAITING to WON without a reason', () => {
    expect(checkTransition({ from: 'AWAITING', to: 'WON', hasReopenPermission: false })).toEqual({ ok: true, reason: null });
  });

  it('requires a trimmed 1..500 character reason for LOST and reopen', () => {
    const lost = (reason?: string) => checkTransition({ from: 'TENDER', to: 'LOST', reason, hasReopenPermission: false });
    expect(lost(undefined)).toMatchObject({ ok: false, code: 'VALIDATION_ERROR', fieldErrors: { reason: 'required' } });
    expect(lost('   ')).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' });
    expect(lost(' x ')).toEqual({ ok: true, reason: 'x' });
    expect(lost(`  ${'a'.repeat(500)}  `)).toEqual({ ok: true, reason: 'a'.repeat(500) });
    expect(lost('a'.repeat(501))).toMatchObject({ ok: false, code: 'VALIDATION_ERROR', fieldErrors: { reason: 'too_long' } });
  });

  it('reopen needs the permission (403) and a reason (422)', () => {
    const reopen = (reason: string | undefined, hasReopenPermission: boolean) =>
      checkTransition({ from: 'LOST', to: 'AWAITING', reason, hasReopenPermission });
    expect(reopen('r', false)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(reopen(undefined, true)).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' });
    expect(reopen('r', true)).toEqual({ ok: true, reason: 'r' });
  });
});

describe('computeTotals', () => {
  it('rounds half-up to two decimals with decimal arithmetic', () => {
    expect(computeTotals('1000.005', '0', '0.05')).toEqual({ subtotal: '1000.01', vatAmount: '50.00', totalAmount: '1050.01' });
    expect(computeTotals('0.10', '0.20', '0.05')).toEqual({ subtotal: '0.30', vatAmount: '0.02', totalAmount: '0.32' });
  });
});
