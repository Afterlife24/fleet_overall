// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { useHireAgreementStore } from '@/store/hireAgreementStore';
import { useBookingStore } from '@/store/bookingStore';
import { useCrmStore, CRM_STORAGE_KEY } from '@/store/crmStore';
import { useAuthStore, JA_ORG_ID } from '@/store/authStore';
import { resolveAllocation } from '@/services/hireLink';
import { AUTO_WON_REASON } from '@/features/crm/crmRules';
import { demoBookings } from '@/services/mock/demoHireLink';
import type { HireAgreement } from '@/types/hireagreement';
import type { Booking, BookingStatus } from '@/types/booking';
import type { Quotation, QuotationPhase } from '@/types/quotation';

// Feature: hire-agreement-planner-link, Property 2: Persistence round trip and legacy migration
// **Validates: Requirements 3.1, 3.2, 3.3, 6.1, 6.2, 6.3, 14.1, 14.2, 15.2**

const BOOKING_KEY = 'fleet-bookings-v1';
const AGREEMENT_KEY = 'fleet-hire-agreements-v1';

const orgArb = fc.constantFrom(JA_ORG_ID, 'org-a', 'org-b');
const textArb = fc.string({ maxLength: 10 });
const statusArb = fc.constantFrom<BookingStatus>(
  'Draft', 'Reserved', 'Pending Approval', 'Approved', 'Allocated', 'On Hire', 'Returned', 'Cancelled',
);
const phaseArb = fc.constantFrom<QuotationPhase>('Awaiting', 'Tender', 'Lost', 'Won');

// Ids are index based so references can point at existing, missing or empty targets.
const refArb = (prefix: string, n: number) =>
  fc.oneof(
    fc.constant(''),
    fc.constant(`${prefix}-missing`),
    fc.integer({ min: 0, max: Math.max(0, n - 1) }).map((i) => `${prefix}${i}`),
  );

interface World {
  quotations: Quotation[];
  agreements: HireAgreement[];
  bookings: Booking[];
}

const worldArb: fc.Arbitrary<World> = fc
  .record({ nq: fc.integer({ min: 1, max: 4 }), na: fc.integer({ min: 1, max: 4 }), nb: fc.integer({ min: 1, max: 5 }) })
  .chain(({ nq, na, nb }) =>
    fc.record({
      quotations: fc.tuple(...Array.from({ length: nq }, (_, i) =>
        fc.record({ orgId: orgArb, phase: phaseArb, name: textArb }).map(
          (r): Quotation => ({
            id: `q${i}`, orgId: r.orgId, number: `QT-${i}`, opportunity: r.name, hireAgreementNo: '',
            customerId: 'CUS-1', customerName: r.name, amount: 1, currency: 'AED', phase: r.phase,
            createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
            history: [{ id: `h${i}`, timestamp: '2025-01-01T00:00:00.000Z', user: 'u', fromPhase: null, toPhase: r.phase }],
          } as Quotation),
        )) as unknown as [fc.Arbitrary<Quotation>]),
      agreements: fc.tuple(...Array.from({ length: na }, (_, i) =>
        fc.record({ orgId: orgArb, quotationId: refArb('q', nq), no: textArb }).map(
          (r): HireAgreement => ({
            id: `a${i}`, orgId: r.orgId, quotationId: r.quotationId, agreementNo: r.no, customerName: r.no,
            status: 'Active',
          } as unknown as HireAgreement),
        )) as unknown as [fc.Arbitrary<HireAgreement>]),
      bookings: fc.tuple(...Array.from({ length: nb }, (_, i) =>
        fc.record({ status: statusArb, ref: refArb('a', na), withOrg: fc.boolean(), org: orgArb }).map(
          (r): Booking => {
            const b: Record<string, unknown> = {
              id: `b${i}`, reference: `BK-${i}`, machineId: `m${i % 2}`, customerName: 'c',
              startDate: '2025-01-01', endDate: '2025-12-31', status: r.status,
            };
            if (r.ref) b.hireAgreementId = r.ref;
            if (r.withOrg) b.orgId = r.org;
            return b as unknown as Booking;
          },
        )) as unknown as [fc.Arbitrary<Booking>]),
    }),
  );

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Drops the in-memory state of the three stores, as a page reload would. */
function wipeMemory() {
  useHireAgreementStore.setState({ agreements: [], seededOrgs: [] });
  useBookingStore.setState({ userBookings: [] });
  useCrmStore.setState({ quotations: [] });
}

function resetAll() {
  localStorage.clear();
  wipeMemory();
  useAuthStore.setState({ user: null, isAuthenticated: false });
}

async function rehydrateAll() {
  await useHireAgreementStore.persist.rehydrate();
  await useBookingStore.persist.rehydrate();
  await useCrmStore.persist.rehydrate();
}

function traceAll(bookings: Booking[]) {
  return bookings.map((b) => resolveAllocation(b.id));
}

describe('persistence round trip and legacy migration', () => {
  beforeEach(resetAll);

  it('keeps agreements, bookings, quotations (with auto-won history) and traces across rehydration', async () => {
    await fc.assert(
      fc.asyncProperty(worldArb, async (w) => {
        resetAll();
        // seededOrgs prevents ensureSeeded (called by resolveAllocation) from adding rows.
        useHireAgreementStore.setState({ agreements: clone(w.agreements), seededOrgs: [JA_ORG_ID] });
        useBookingStore.setState({ userBookings: clone(w.bookings) });
        useCrmStore.setState({ quotations: clone(w.quotations) });

        // Auto-won history for every quotation the store allows to change.
        for (const q of w.quotations) useCrmStore.getState().autoWon(q.orgId, q.id, 'System');

        const before = {
          agreements: clone(useHireAgreementStore.getState().agreements),
          seeded: clone(useHireAgreementStore.getState().seededOrgs),
          bookings: clone(useBookingStore.getState().userBookings),
          quotations: clone(useCrmStore.getState().quotations),
          traces: clone(traceAll(w.bookings)),
        };

        // Wiping memory writes empty state through persist, so restore the stored payloads first,
        // as a fresh page load would find them.
        const stored = [AGREEMENT_KEY, BOOKING_KEY, CRM_STORAGE_KEY].map((k) => [k, localStorage.getItem(k)!] as const);
        wipeMemory();
        for (const [k, v] of stored) localStorage.setItem(k, v);
        await rehydrateAll();

        expect(useHireAgreementStore.getState().agreements).toEqual(before.agreements);
        expect(useHireAgreementStore.getState().seededOrgs).toEqual(before.seeded);
        expect(useBookingStore.getState().userBookings).toEqual(before.bookings);
        expect(useCrmStore.getState().quotations).toEqual(before.quotations);
        expect(clone(traceAll(w.bookings))).toEqual(before.traces);

        // Auto-won entries survive: Awaiting/Tender became Won with the auto reason; Lost/Won are untouched.
        for (const q of w.quotations) {
          const after = useCrmStore.getState().quotations.find((x) => x.id === q.id)!;
          if (q.phase === 'Awaiting' || q.phase === 'Tender') {
            expect(after.phase).toBe('Won');
            const last = after.history[after.history.length - 1];
            expect(last).toMatchObject({ fromPhase: q.phase, toPhase: 'Won', reason: AUTO_WON_REASON, user: 'System' });
            expect(after.history).toHaveLength(q.history.length + 1);
          } else {
            expect(after.phase).toBe(q.phase);
            expect(after.history).toHaveLength(q.history.length);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('migrates legacy agreement rows (no orgId/quotationId) and legacy booking rows (no orgId/hireAgreementId)', async () => {
    const legacyAgreementArb = fc.record(
      {
        orgId: orgArb,
        quotationId: fc.constantFrom('', 'q0', 'q1'),
        agreementNo: textArb,
        customerName: textArb,
      },
      { requiredKeys: ['agreementNo', 'customerName'] },
    );
    const legacyBookingStatus = statusArb;

    await fc.assert(
      fc.asyncProperty(
        fc.array(legacyAgreementArb, { minLength: 1, maxLength: 5 }),
        fc.array(legacyBookingStatus, { minLength: 1, maxLength: 5 }),
        async (rawAgreements, statuses) => {
          resetAll();
          const agreements = rawAgreements.map((a, i) => ({ id: `ha-legacy-${i}`, ...a }));
          const bookings = statuses.map((status, i) => ({
            id: `bk-legacy-${i}`, reference: `BK-${i}`, machineId: 'm1', customerName: 'c',
            startDate: '2025-01-01', endDate: '2025-12-31', status,
          }));
          localStorage.setItem(AGREEMENT_KEY, JSON.stringify({ state: { agreements, seededOrgs: [JA_ORG_ID] }, version: 0 }));
          localStorage.setItem(BOOKING_KEY, JSON.stringify({ state: { userBookings: bookings }, version: 0 }));

          await useHireAgreementStore.persist.rehydrate();
          await useBookingStore.persist.rehydrate();

          const migrated = useHireAgreementStore.getState().agreements;
          expect(migrated).toHaveLength(agreements.length);
          agreements.forEach((raw, i) => {
            expect(migrated[i]).toEqual({
              ...raw,
              orgId: (raw as { orgId?: string }).orgId ?? JA_ORG_ID,
              quotationId: (raw as { quotationId?: string }).quotationId ?? '',
            });
          });

          // Legacy rows stay as they were; the demo bookings are appended (v1 -> v2).
          const all = useBookingStore.getState().userBookings;
          const migratedBookings = all.filter((b) => b.id.startsWith('bk-legacy-'));
          expect(migratedBookings).toEqual(bookings);
          expect(all.map((b) => b.id)).toEqual([...bookings.map((b) => b.id), ...demoBookings.map((b) => b.id)]);
          for (const b of migratedBookings) {
            expect('hireAgreementId' in b).toBe(false);
            expect('orgId' in b).toBe(false);
            expect(resolveAllocation(b.id)).toEqual({ ok: false, reason: 'NO_AGREEMENT_ID' });
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('falls back to empty lists for a malformed persisted agreement state', async () => {
    localStorage.setItem(AGREEMENT_KEY, JSON.stringify({ state: { agreements: 'nope' }, version: 0 }));
    localStorage.setItem(BOOKING_KEY, JSON.stringify({ state: {}, version: 0 }));
    await useHireAgreementStore.persist.rehydrate();
    await useBookingStore.persist.rehydrate();
    expect(useHireAgreementStore.getState().agreements).toEqual([]);
    // A malformed booking state falls back to the demo bookings only.
    expect(useBookingStore.getState().userBookings.map((b) => b.id)).toEqual(demoBookings.map((b) => b.id));
  });

  it('keeps persisted CRM data under its own storage key', () => {
    expect(CRM_STORAGE_KEY).toBe('fleet-crm-v1');
  });
});
