// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { migrateMqdState, useMqdStore } from '@/store/mqdStore';
import { mergedMqdList } from '@/services/collectionDocs';
import { JA_ORG_ID } from '@/store/authStore';
import type { MqdRecord } from '@/types/collection';
import type { Inspection } from '@/types/inspection';

// Feature: offhire-collection-docs, Property 20: MQD persistence round trip and merge
// **Validates: Requirements 10.1, 10.3, 10.4**

const text = fc.string({ maxLength: 20 });
const word = fc.stringMatching(/^[A-Za-z0-9-]{1,10}$/);

const mqdArb: fc.Arbitrary<MqdRecord> = fc.record({
  machineId: word,
  fleetNo: word,
  machineDescription: text,
  serialNumber: text,
  customerName: text,
  customerId: text,
  bookingId: text,
  bookingRef: text,
  hireAgreementId: text,
  hireAgreementNo: text,
  quotationId: text,
  quotationNo: text,
  invoiceId: text,
  invoiceNo: text,
  site: text,
  missing: fc.subarray(['BOOKING', 'AGREEMENT', 'QUOTATION', 'INVOICE'] as const),
  refNotes: fc.array(text, { maxLength: 3 }),
  id: word,
  orgId: fc.constant(JA_ORG_ID),
  number: word,
  signedStatus: fc.constantFrom('Pending', 'Signed') as fc.Arbitrary<'Pending' | 'Signed'>,
  createdAt: fc.constant('2026-01-01T00:00:00.000Z'),
  updatedAt: fc.constant('2026-01-02T00:00:00.000Z'),
  date: fc.constant('2026-03-01'),
  hirer: text,
  fields: fc.dictionary(word, text, { maxKeys: 5 }),
  photoKeys: fc.array(word, { maxLength: 3 }),
}) as fc.Arbitrary<MqdRecord>;

const mockArb: fc.Arbitrary<Inspection> = fc
  .record({ id: word, reference: word, assetNumber: word })
  .map((r) => r as unknown as Inspection);

const reset = () => useMqdStore.setState({ records: [], counters: {}, demoSeededOrgs: [] });

describe('Property 20: MQD persistence round trip and merge', () => {
  beforeEach(reset);

  it('insert then read back returns an equal record, also after JSON persistence', () => {
    fc.assert(
      fc.property(mqdArb, (rec) => {
        reset();
        useMqdStore.getState().insert(rec);
        expect(useMqdStore.getState().getById(rec.id)).toEqual(rec);
        expect(useMqdStore.getState().forOrg(JA_ORG_ID)).toContainEqual(rec);

        const stored = JSON.parse(JSON.stringify({ records: useMqdStore.getState().records }));
        const migrated = migrateMqdState(stored);
        expect(migrated.records).toEqual([rec]);
      }),
      { numRuns: 100 }
    );
  });

  it('merged list contains every persisted record and every mock row', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(mqdArb, { selector: (r) => r.id, maxLength: 6 }),
        fc.uniqueArray(mockArb, { selector: (r) => r.id, maxLength: 6 }),
        (records, mocks) => {
          reset();
          for (const r of records) useMqdStore.getState().insert(r);
          const merged = mergedMqdList(mocks);
          expect(merged).toHaveLength(records.length + mocks.length);
          for (const r of records) {
            expect(merged.some((m) => m.persisted && m.id === r.id && m.reference === r.number)).toBe(true);
          }
          for (const m of mocks) {
            expect(
              merged.some((x) => !x.persisted && x.id === m.id && x.reference === m.reference)
            ).toBe(true);
          }
          // persisted records come first
          const firstMock = merged.findIndex((x) => !x.persisted);
          if (firstMock >= 0) expect(merged.slice(firstMock).every((x) => !x.persisted)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});
