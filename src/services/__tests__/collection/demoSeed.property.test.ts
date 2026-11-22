// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('@/lib/toast-helper', () => ({
  showSuccess: vi.fn(), showError: vi.fn(), showInfo: vi.fn(), showWarning: vi.fn(),
  toastSuccess: vi.fn(), toastError: vi.fn(), toastInfo: vi.fn(), toastWarning: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { JA_ORG_ID } from '@/store/authStore';
import { useOrgStore } from '@/store/orgStore';
import { useCrmStore } from '@/store/crmStore';
import { useHireAgreementStore } from '@/store/hireAgreementStore';
import { useBookingStore } from '@/store/bookingStore';
import { useTaxInvoiceStore } from '@/store/taxInvoiceStore';
import { useCollectionStore } from '@/store/collectionStore';
import { useMqdStore } from '@/store/mqdStore';
import { useThirdPartyStore } from '@/store/thirdPartyStore';
import { ensureCollectionDemo, ensureHireLinkDemo } from '@/services/demoSeed';
import { machinesForOrg } from '@/services/mock/orgData';
import { buildQrPayload, resolveQr, type MachineLite } from '@/services/collectionCore';

// Feature: offhire-collection-docs, Property 21: Demo seed idempotence and org-specific ids
// **Validates: Requirements 12.1, 12.8, 12.9, 12.10**

const ORG_TWO = 'org-demo-two';
const ORG_THREE = 'org-demo-three';
const ORGS = [JA_ORG_ID, ORG_TWO, ORG_THREE];

function resetAll() {
  localStorage.clear();
  useCrmStore.getState().resetToSeed();
  useHireAgreementStore.setState({ agreements: [], seededOrgs: [] });
  useBookingStore.setState({ userBookings: [] });
  useTaxInvoiceStore.setState({ invoices: [], seededOrgs: [], demoLinkedOrgs: [], sequenceByQuotation: {} });
  useCollectionStore.setState({ notes: [], counters: {}, demoSeededOrgs: [] });
  useMqdStore.setState({ records: [], counters: {}, demoSeededOrgs: [] });
  useThirdPartyStore.setState({ documents: [], counters: {}, demoSeededOrgs: [] });
}

function activate(orgId: string) {
  useOrgStore.getState().activateApp(orgId, 'crm');
}

function seed(orgId: string) {
  activate(orgId);
  ensureHireLinkDemo(orgId);
}

const notesOf = (o: string) => useCollectionStore.getState().notes.filter((n) => n.orgId === o);
const mqdsOf = (o: string) => useMqdStore.getState().records.filter((n) => n.orgId === o);
const tpsOf = (o: string) => useThirdPartyStore.getState().documents.filter((n) => n.orgId === o);

function snapshot() {
  return JSON.stringify({
    n: useCollectionStore.getState().notes,
    nc: useCollectionStore.getState().counters,
    m: useMqdStore.getState().records,
    mc: useMqdStore.getState().counters,
    t: useThirdPartyStore.getState().documents,
    tc: useThirdPartyStore.getState().counters,
  });
}

beforeEach(resetAll);

describe('demo collection documents', () => {
  it('org-ja: CN-2026-0001 and CN-2026-0002 carry the specified references', () => {
    seed(JA_ORG_ID);
    const n1 = notesOf(JA_ORG_ID).find((n) => n.number === 'CN-2026-0001')!;
    const n2 = notesOf(JA_ORG_ID).find((n) => n.number === 'CN-2026-0002')!;
    expect(n1.quotationNo).toBe('QT-2026-0010');
    expect(n1.hireAgreementNo).toBe('HA-2026-005');
    expect(n1.invoiceNo).toBe('QT-2026-0010/01');
    expect(n1.customerName).toBe('MNO Company LLC');
    expect(n2.hireAgreementNo).toBe('HA-2026-004');
    expect(n2.invoiceNo).toBe('INV-2026-004');
  });

  it('second org: CN-2026-0001 carries the specified references; CN-2026-0002 has HA-2026-004', () => {
    seed(ORG_TWO);
    const n1 = notesOf(ORG_TWO).find((n) => n.number === 'CN-2026-0001')!;
    const n2 = notesOf(ORG_TWO).find((n) => n.number === 'CN-2026-0002')!;
    expect(n1.quotationNo).toBe('QT-2026-0010');
    expect(n1.hireAgreementNo).toBe('HA-2026-005');
    expect(n1.invoiceNo).toBe('QT-2026-0010/01');
    expect(n1.customerName).toBe('MNO Company LLC');
    expect(n2.hireAgreementNo).toBe('HA-2026-004');
    // Actual: a quotation is linked, so QUOTATION is not missing.
    expect(n2.quotationNo).toBe('QT-2026-0009');
    expect(n2.missing).not.toContain('QUOTATION');
  });

  it('second org: CN-2026-0002 resolves invoice INV-2026-004', () => {
    seed(ORG_TWO);
    const n2 = notesOf(ORG_TWO).find((n) => n.number === 'CN-2026-0002')!;
    expect(n2.invoiceNo).toBe('INV-2026-004');
  });

  for (const orgId of [JA_ORG_ID, ORG_TWO]) {
    it(`seeds numbers, fleet numbers, signed state and totals for ${orgId}`, () => {
      seed(orgId);
      const n1 = notesOf(orgId).find((n) => n.number === 'CN-2026-0001')!;
      const n2 = notesOf(orgId).find((n) => n.number === 'CN-2026-0002')!;
      expect(n1.fleetNo).toBe('J105');
      expect(n1.status).toBe('Scheduled');
      expect(n2.fleetNo).toBe('J104');
      expect(n2.status).toBe('Collected');
      expect(n2.signedStatus).toBe('Signed');

      const tps1 = tpsOf(orgId).find((d) => d.number === 'TPS-2026-0001')!;
      expect(tps1.lines.reduce((s, l) => s + l.quantity * l.rate, 0)).toBe(3700);

      expect(n1.id).toContain(orgId);
      expect(n2.id).toContain(orgId);
      expect(mqdsOf(orgId)).toHaveLength(2);
      expect(tpsOf(orgId)).toHaveLength(2);
    });

    it(`QR payload of each demo note resolves to its machine for ${orgId}`, () => {
      seed(orgId);
      const machines: MachineLite[] = machinesForOrg(orgId).map((m) => ({
        orgId, id: m.id, fleetNo: m.fleetNo, assetNumber: m.assetNumber,
        make: m.make, model: m.model, serialNumber: m.serialNumber,
      }));
      for (const n of notesOf(orgId)) {
        const machine = machines.find((m) => m.id === n.machineId)!;
        expect(machine).toBeDefined();
        const r = resolveQr(buildQrPayload(machine), orgId, machines);
        expect(r.ok && r.machine.id).toBe(n.machineId);
      }
    });
  }

  it('uses org-specific ids and number counters per organisation', () => {
    seed(JA_ORG_ID);
    seed(ORG_TWO);
    const ids = [
      ...useCollectionStore.getState().notes, ...useMqdStore.getState().records,
      ...useThirdPartyStore.getState().documents,
    ].map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const o of [JA_ORG_ID, ORG_TWO]) {
      for (const d of [...notesOf(o), ...mqdsOf(o), ...tpsOf(o)]) expect(d.id).toContain(o);
    }
    expect(useCollectionStore.getState().counters[`${ORG_TWO}|CN|2026`]).toBe(2);
  });

  it('adds nothing on a second run and does not re-add a deleted row', () => {
    seed(ORG_TWO);
    const before = snapshot();
    ensureCollectionDemo(ORG_TWO);
    ensureHireLinkDemo(ORG_TWO);
    expect(snapshot()).toBe(before);

    const id = notesOf(ORG_TWO)[0].id;
    useCollectionStore.getState().remove(id);
    ensureCollectionDemo(ORG_TWO);
    ensureHireLinkDemo(ORG_TWO);
    expect(notesOf(ORG_TWO).some((n) => n.id === id)).toBe(false);
    expect(notesOf(ORG_TWO)).toHaveLength(1);
  });
});

describe('Property 21: random seed/delete sequences', () => {
  type Op =
    | { k: 'seed'; org: string }
    | { k: 'del'; org: string; store: 'cn' | 'mqd' | 'tps'; idx: number };

  const opArb: fc.Arbitrary<Op> = fc.oneof(
    fc.record({ k: fc.constant('seed' as const), org: fc.constantFrom(...ORGS) }),
    fc.record({
      k: fc.constant('del' as const),
      org: fc.constantFrom(...ORGS),
      store: fc.constantFrom('cn' as const, 'mqd' as const, 'tps' as const),
      idx: fc.nat(1),
    }),
  );

  it('never duplicates, never revives deleted rows, ids stay org-specific', () => {
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 1, maxLength: 20 }), (ops) => {
        resetAll();
        const deleted = new Set<string>();
        const seen = new Set<string>();
        for (const op of ops) {
          if (op.k === 'seed') {
            seed(op.org);
            seen.add(op.org);
          } else {
            const list = op.store === 'cn' ? notesOf(op.org) : op.store === 'mqd' ? mqdsOf(op.org) : tpsOf(op.org);
            const row = list[op.idx];
            if (!row) continue;
            if (op.store === 'cn') useCollectionStore.getState().remove(row.id);
            else if (op.store === 'mqd') useMqdStore.getState().remove(row.id);
            else useThirdPartyStore.getState().remove(row.id);
            deleted.add(row.id);
          }
          const all = [
            ...useCollectionStore.getState().notes, ...useMqdStore.getState().records,
            ...useThirdPartyStore.getState().documents,
          ];
          const ids = all.map((d) => d.id);
          expect(new Set(ids).size).toBe(ids.length);
          for (const d of all) {
            expect(deleted.has(d.id)).toBe(false);
            expect(d.id).toContain(d.orgId);
          }
        }
        for (const o of ORGS) {
          if (!seen.has(o)) {
            expect(notesOf(o)).toHaveLength(0);
          } else {
            expect(notesOf(o).length).toBeLessThanOrEqual(2);
            expect(mqdsOf(o).length).toBeLessThanOrEqual(2);
            expect(tpsOf(o).length).toBeLessThanOrEqual(2);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('running twice equals running once', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ORGS), (org) => {
        resetAll();
        seed(org);
        const once = snapshot();
        ensureCollectionDemo(org);
        seed(org);
        expect(snapshot()).toBe(once);
      }),
      { numRuns: 100 },
    );
  });
});
