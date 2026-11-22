// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useTaxInvoiceStore } from '../taxInvoiceStore';
import { taxInvoices as seedInvoices } from '@/services/mock/taxinvoice';
import type { TaxInvoice } from '@/types/taxinvoice';

const STORAGE_KEY = 'fleet-tax-invoices-v1';

const EMPTY = {
  invoices: [] as TaxInvoice[],
  seededOrgs: [] as string[],
  demoLinkedOrgs: [] as string[],
  sequenceByQuotation: {} as Record<string, number>,
};

function makeInvoice(id: string, extra: Partial<TaxInvoice> = {}): TaxInvoice {
  return { ...seedInvoices[0], id, orgId: 'org-a', ...extra } as TaxInvoice;
}

describe('taxInvoiceStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useTaxInvoiceStore.setState({ ...EMPTY });
  });

  describe('ensureSeeded', () => {
    it('seeds demo invoices once per org with deterministic ids', () => {
      const s = useTaxInvoiceStore.getState();
      s.ensureSeeded('org-a');
      const first = useTaxInvoiceStore.getState().forOrg('org-a');
      expect(first).toHaveLength(seedInvoices.length);
      expect(first[0].id).toBe('inv-seed-org-a-1');
      expect(first.every((i) => i.orgId === 'org-a')).toBe(true);

      useTaxInvoiceStore.getState().ensureSeeded('org-a');
      expect(useTaxInvoiceStore.getState().forOrg('org-a')).toHaveLength(seedInvoices.length);
      expect(useTaxInvoiceStore.getState().seededOrgs).toEqual(['org-a']);
    });

    it('seeds each org separately', () => {
      useTaxInvoiceStore.getState().ensureSeeded('org-a');
      useTaxInvoiceStore.getState().ensureSeeded('org-b');
      const st = useTaxInvoiceStore.getState();
      expect(st.forOrg('org-a')).toHaveLength(seedInvoices.length);
      expect(st.forOrg('org-b')).toHaveLength(seedInvoices.length);
      expect(st.invoices).toHaveLength(seedInvoices.length * 2);
    });

    it('does not re-seed rows the user deleted', () => {
      useTaxInvoiceStore.getState().ensureSeeded('org-a');
      useTaxInvoiceStore.getState().remove('inv-seed-org-a-1');
      useTaxInvoiceStore.getState().ensureSeeded('org-a');
      expect(useTaxInvoiceStore.getState().getById('inv-seed-org-a-1')).toBeUndefined();
    });
  });

  describe('insertLinked and remove', () => {
    it('insertLinked bumps the quotation counter to the max sequence', () => {
      const st = useTaxInvoiceStore.getState();
      st.insertLinked(makeInvoice('i1', { quotationId: 'q1', sequence: 1 }));
      expect(useTaxInvoiceStore.getState().sequenceByQuotation.q1).toBe(1);
      useTaxInvoiceStore.getState().insertLinked(makeInvoice('i2', { quotationId: 'q1', sequence: 2 }));
      expect(useTaxInvoiceStore.getState().sequenceByQuotation.q1).toBe(2);
      useTaxInvoiceStore.getState().insertLinked(makeInvoice('i3', { quotationId: 'q1', sequence: 1 }));
      expect(useTaxInvoiceStore.getState().sequenceByQuotation.q1).toBe(2);
      expect(useTaxInvoiceStore.getState().invoices).toHaveLength(3);
    });

    it('remove keeps the counter so numbers are not reused', () => {
      useTaxInvoiceStore.getState().insertLinked(makeInvoice('i1', { quotationId: 'q1', sequence: 1 }));
      useTaxInvoiceStore.getState().insertLinked(makeInvoice('i2', { quotationId: 'q1', sequence: 2 }));
      useTaxInvoiceStore.getState().remove('i2');
      const st = useTaxInvoiceStore.getState();
      expect(st.getById('i2')).toBeUndefined();
      expect(st.sequenceByQuotation.q1).toBe(2);
    });

    it('plain insert does not touch counters', () => {
      useTaxInvoiceStore.getState().insert(makeInvoice('i1', { quotationId: 'q1', sequence: 3 }));
      expect(useTaxInvoiceStore.getState().sequenceByQuotation).toEqual({});
    });
  });

  describe('patch and newId', () => {
    it('patch updates fields but keeps id, orgId and createdAt', () => {
      useTaxInvoiceStore.getState().insert(makeInvoice('i1', { createdAt: '2026-01-01T00:00:00.000Z' }));
      const updated = useTaxInvoiceStore
        .getState()
        .patch('i1', { id: 'x', orgId: 'org-z', createdAt: 'nope', notes: 'hello' } as Partial<TaxInvoice>);
      expect(updated.id).toBe('i1');
      expect(updated.orgId).toBe('org-a');
      expect(updated.createdAt).toBe('2026-01-01T00:00:00.000Z');
      expect(useTaxInvoiceStore.getState().getById('i1')).toEqual(updated);
    });

    it('patch throws for an unknown id', () => {
      expect(() => useTaxInvoiceStore.getState().patch('missing', {})).toThrow(
        'Tax invoice not found'
      );
    });

    it('newId returns unique ids not already used', () => {
      const ids = new Set<string>();
      for (let n = 0; n < 50; n++) {
        const id = useTaxInvoiceStore.getState().newId();
        expect(ids.has(id)).toBe(false);
        ids.add(id);
        useTaxInvoiceStore.getState().insert(makeInvoice(id));
      }
    });
  });

  describe('persistence', () => {
    it('round trips through localStorage via persist.rehydrate()', async () => {
      useTaxInvoiceStore.getState().ensureSeeded('org-a');
      useTaxInvoiceStore.getState().insertLinked(makeInvoice('i1', { quotationId: 'q1', sequence: 2 }));
      useTaxInvoiceStore.setState({ demoLinkedOrgs: ['org-a'] });

      const raw = localStorage.getItem(STORAGE_KEY);
      expect(raw).not.toBeNull();
      const stored = JSON.parse(raw as string);
      expect(stored.version).toBe(3);
      expect(Object.keys(stored.state).sort()).toEqual(
        ['demoLinkedOrgs', 'invoices', 'seededOrgs', 'sequenceByQuotation'].sort()
      );

      const before = useTaxInvoiceStore.getState();
      const snapshot = {
        invoices: before.invoices,
        seededOrgs: before.seededOrgs,
        demoLinkedOrgs: before.demoLinkedOrgs,
        sequenceByQuotation: before.sequenceByQuotation,
      };

      useTaxInvoiceStore.setState({ ...EMPTY }, false);
      // setState re-persists the empty state; restore the saved payload before rehydrating.
      localStorage.setItem(STORAGE_KEY, raw as string);
      await useTaxInvoiceStore.persist.rehydrate();

      const after = useTaxInvoiceStore.getState();
      expect(after.invoices).toEqual(snapshot.invoices);
      expect(after.seededOrgs).toEqual(snapshot.seededOrgs);
      expect(after.demoLinkedOrgs).toEqual(snapshot.demoLinkedOrgs);
      expect(after.sequenceByQuotation).toEqual(snapshot.sequenceByQuotation);
    });

    it('rehydrating does not re-seed an already seeded org', async () => {
      useTaxInvoiceStore.getState().ensureSeeded('org-a');
      const raw = localStorage.getItem(STORAGE_KEY) as string;
      useTaxInvoiceStore.setState({ ...EMPTY });
      localStorage.setItem(STORAGE_KEY, raw);
      await useTaxInvoiceStore.persist.rehydrate();
      useTaxInvoiceStore.getState().ensureSeeded('org-a');
      expect(useTaxInvoiceStore.getState().invoices).toHaveLength(seedInvoices.length);
    });
  });
});
