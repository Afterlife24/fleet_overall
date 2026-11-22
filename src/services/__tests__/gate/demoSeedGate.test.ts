// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
import { useGateStore } from '@/store/gateStore';
import { ensureGateDemo, ensureHireLinkDemo } from '@/services/demoSeed';
import { demoGateSeedsForOrg } from '@/services/mock/demoGate';
import { useAppStore } from '@/store/appStore';
import { machinesForOrg } from '@/services/mock/orgData';
import { buildQrPayload, type MachineLite } from '@/services/collectionCore';
import { resolveGateScan } from '@/services/gateCore';
import { appMachineResolver } from '@/features/fleet/collectionWiring';

const NEW_ORG = 'org-test-xyz';

function resetAll() {
  localStorage.clear();
  useCrmStore.getState().resetToSeed();
  useHireAgreementStore.setState({ agreements: [], seededOrgs: [] });
  useBookingStore.setState({ userBookings: [] });
  useTaxInvoiceStore.setState({ invoices: [], seededOrgs: [], demoLinkedOrgs: [], sequenceByQuotation: {} });
  useCollectionStore.setState({ notes: [], counters: {}, demoSeededOrgs: [] });
  useMqdStore.setState({ records: [], counters: {}, demoSeededOrgs: [] });
  useThirdPartyStore.setState({ documents: [], counters: {}, demoSeededOrgs: [] });
  useGateStore.setState({ entries: [], seedMarkers: {}, legacyImported: true });
}

const gateOf = (o: string) => useGateStore.getState().entries.filter((r) => r.orgId === o);
const noteOf = (o: string, num: string) =>
  useCollectionStore.getState().notes.find((n) => n.orgId === o && n.number === num)!;
const lites = (o: string): MachineLite[] => appMachineResolver.list(o);
const fleet = (o: string, f: string) => lites(o).find((m) => m.fleetNo === f)!;

beforeEach(resetAll);

describe.each([JA_ORG_ID, NEW_ORG])('gate demo seeder for %s', (orgId) => {
  beforeEach(() => {
    useOrgStore.getState().activateApp(orgId, 'gate');
  });

  it('creates the three rows for J105, J104 and J101', () => {
    ensureGateDemo(orgId);
    const rows = gateOf(orgId);
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3].map((n) => `ge-demo-${orgId}-${n}`));
    expect(rows.map((r) => r.reference)).toEqual(['GP-DEMO-1', 'GP-DEMO-2', 'GP-DEMO-3']);
    expect(rows.map((r) => r.fleetNo)).toEqual(['J105', 'J104', 'J101']);
    expect(rows.map((r) => r.status)).toEqual(['Completed', 'Completed', 'Pending']);
    expect(useGateStore.getState().seedMarkers[orgId]).toHaveLength(3);
  });

  it('scanning the J105 payload resolves to J105', () => {
    ensureGateDemo(orgId);
    const j105 = fleet(orgId, 'J105');
    const r = resolveGateScan(buildQrPayload(j105), orgId, lites(orgId));
    expect(r.ok && r.machine.fleetNo).toBe('J105');
  });

  it('keeps J105 On Hire and CN-2026-0001 untouched, and links CN-2026-0002 once', () => {
    const j105 = () => machinesForOrg(orgId).find((m) => m.fleetNo === 'J105')!;
    ensureHireLinkDemo(orgId);
    const statusBefore = j105().status;
    const overridesBefore = JSON.stringify(useAppStore.getState().machineOverrides);
    ensureGateDemo(orgId);
    expect(j105().status).toBe(statusBefore);
    expect(JSON.stringify(useAppStore.getState().machineOverrides)).toBe(overridesBefore);
    const n1 = noteOf(orgId, 'CN-2026-0001');
    expect(n1.status).toBe('Scheduled');
    expect(n1.collectedByGateId).toBeUndefined();
    const n2 = noteOf(orgId, 'CN-2026-0002');
    const j104 = gateOf(orgId)[1];
    expect(n2.collectedByGateId).toBe(j104.id);
    expect(n2.collectedByGateRef).toBe('GP-DEMO-2');
    expect(n2.collectedAt).toBe(j104.timestamp);
  });

  it('a second call creates nothing and a deleted seed does not return', () => {
    ensureGateDemo(orgId);
    const before = JSON.stringify(useGateStore.getState().entries);
    ensureGateDemo(orgId);
    expect(JSON.stringify(useGateStore.getState().entries)).toBe(before);

    const id = `ge-demo-${orgId}-3`;
    useGateStore.setState((s) => ({ entries: s.entries.filter((r) => r.id !== id) }));
    ensureGateDemo(orgId);
    expect(gateOf(orgId).some((r) => r.id === id)).toBe(false);
    expect(gateOf(orgId)).toHaveLength(2);
  });

  it('leaves an existing CN-2026-0002 link unchanged', () => {
    useOrgStore.getState().activateApp(orgId, 'crm');
    ensureGateDemo(orgId);
    const n2 = noteOf(orgId, 'CN-2026-0002');
    useCollectionStore.getState().patch(n2.id, { collectedByGateId: 'x', collectedByGateRef: 'GP-X', collectedAt: '2026-11-28T00:00:00.000Z' });
    useGateStore.setState({ entries: [], seedMarkers: {} });
    ensureGateDemo(orgId);
    const after = noteOf(orgId, 'CN-2026-0002');
    expect([after.collectedByGateId, after.collectedByGateRef, after.collectedAt])
      .toEqual(['x', 'GP-X', '2026-11-28T00:00:00.000Z']);
  });
});

describe('gate demo seeder edge cases', () => {
  it('a company without J104 gets the other two rows and no row 2', () => {
    const org = 'org-no-j104';
    useOrgStore.getState().activateApp(org, 'gate');
    ensureHireLinkDemo(org);
    const machines = lites(org).filter((m) => m.fleetNo !== 'J104');
    const rows = demoGateSeedsForOrg(org, { machines, booking: { id: 'bk', startDate: '2026-12-10' } });
    expect(rows.map((r) => r.reference)).toEqual(['GP-DEMO-1', 'GP-DEMO-3']);
  });
  it('does nothing and does not throw for an empty org id', () => {
    expect(() => ensureGateDemo('')).not.toThrow();
    expect(useGateStore.getState().entries).toHaveLength(0);
  });

  it('seeds nothing for a company without any demo app active', () => {
    ensureGateDemo('org-plain');
    expect(gateOf('org-plain')).toHaveLength(0);
  });
});
