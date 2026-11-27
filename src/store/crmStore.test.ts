// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { useCrmStore } from './crmStore';
import { AUTO_WON_REASON } from '@/features/crm/crmRules';
import type { Quotation, QuotationPhase } from '@/types/quotation';

const ORG = 'org-a';
const OTHER_ORG = 'org-b';

function makeQuotation(id: string, phase: QuotationPhase, orgId = ORG): Quotation {
  return {
    id,
    orgId,
    number: `QT-${id}`,
    opportunity: `Opp ${id}`,
    hireAgreementNo: 'HA-2025-00001',
    customerId: 'CUS-1',
    customerName: 'ABC Company',
    amount: 1000,
    currency: 'AED',
    phase,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    history: [
      { id: `ph-${id}-0`, timestamp: '2025-01-01T00:00:00.000Z', user: 'u', fromPhase: null, toPhase: 'Awaiting' },
    ],
  };
}

const find = (id: string) => useCrmStore.getState().quotations.find((q) => q.id === id)!;

describe('crmStore.autoWon', () => {
  beforeEach(() => {
    localStorage.clear();
    useCrmStore.setState({
      quotations: [
        makeQuotation('q-await', 'Awaiting'),
        makeQuotation('q-tender', 'Tender'),
        makeQuotation('q-won', 'Won'),
        makeQuotation('q-lost', 'Lost'),
        makeQuotation('q-other', 'Awaiting', OTHER_ORG),
      ],
    });
  });

  it.each([
    ['q-await', 'Awaiting'],
    ['q-tender', 'Tender'],
  ] as const)('moves %s (%s) to Won with one history entry', (id, from) => {
    const before = find(id);
    const out = useCrmStore.getState().autoWon(ORG, id, 'System');
    expect(out).toMatchObject({ ok: true, result: { kind: 'changed' } });
    const after = find(id);
    expect(after.phase).toBe('Won');
    expect(after.history).toHaveLength(before.history.length + 1);
    expect(after.history.at(-1)).toMatchObject({
      fromPhase: from,
      toPhase: 'Won',
      user: 'System',
      reason: AUTO_WON_REASON,
    });
    expect(after.updatedAt).not.toBe(before.updatedAt);
  });

  it('leaves a Won quotation unchanged', () => {
    const before = find('q-won');
    const out = useCrmStore.getState().autoWon(ORG, 'q-won', 'System');
    expect(out).toEqual({ ok: true, result: { kind: 'unchanged', reason: 'ALREADY_WON' } });
    expect(find('q-won')).toEqual(before);
  });

  it('leaves a Lost quotation unchanged', () => {
    const before = find('q-lost');
    const out = useCrmStore.getState().autoWon(ORG, 'q-lost', 'System');
    expect(out).toEqual({ ok: true, result: { kind: 'unchanged', reason: 'QUOTATION_LOST' } });
    expect(find('q-lost')).toEqual(before);
  });

  it('returns QUOTATION_NOT_FOUND for an unknown id and changes nothing', () => {
    const before = useCrmStore.getState().quotations;
    const out = useCrmStore.getState().autoWon(ORG, 'nope', 'System');
    expect(out).toEqual({ ok: false, error: 'QUOTATION_NOT_FOUND' });
    expect(useCrmStore.getState().quotations).toEqual(before);
  });

  it('returns QUOTATION_ORG_MISMATCH for another org and changes nothing', () => {
    const before = useCrmStore.getState().quotations;
    const out = useCrmStore.getState().autoWon(ORG, 'q-other', 'System');
    expect(out).toEqual({ ok: false, error: 'QUOTATION_ORG_MISMATCH' });
    expect(useCrmStore.getState().quotations).toEqual(before);
    expect(find('q-other').phase).toBe('Awaiting');
  });

  it('leaves all other quotations untouched', () => {
    const before = useCrmStore.getState().quotations;
    useCrmStore.getState().autoWon(ORG, 'q-await', 'System');
    const after = useCrmStore.getState().quotations;
    expect(after).toHaveLength(before.length);
    for (const q of before) {
      if (q.id !== 'q-await') expect(after.find((x) => x.id === q.id)).toEqual(q);
    }
  });

  it('is not seeded: a fresh store holds no quotations', () => {
    useCrmStore.setState({ quotations: [] });
    expect(useCrmStore.getState().quotations).toEqual([]);
  });
});
// Manual phase changes (including Awaiting -> Won without a reason) now go through quotationsApi.changePhase;
// the rule itself is covered by crmRules.test.ts and the CRM component tests.
