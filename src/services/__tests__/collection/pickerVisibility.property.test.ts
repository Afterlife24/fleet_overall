import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { canInitiate, pickerMachines, type MachineLite } from '../../collectionCore';

// Feature: offhire-collection-docs, Property 14: Picker and action visibility
// **Validates: Requirements 1.3, 1.5, 1.6, 1.7**

const STATUSES = ['On Hire', 'Available', 'Under Maintenance', 'Reserved', 'Off Hire', 'on hire', ''];

const machineArb = (id: string): fc.Arbitrary<MachineLite> =>
  fc.record({
    id: fc.constant(id),
    orgId: fc.constantFrom('org-a', 'org-b'),
    assetNumber: fc.string({ maxLength: 8 }),
  }) as unknown as fc.Arbitrary<MachineLite>;

const listArb = fc
  .uniqueArray(fc.string({ minLength: 1, maxLength: 6 }), { maxLength: 15 })
  .chain((ids) =>
    fc.tuple(
      fc.tuple(...ids.map(machineArb)),
      fc.tuple(...ids.map(() => fc.constantFrom(...STATUSES))),
    ),
  )
  .map(([machines, statuses]) => ({ machines: machines as MachineLite[], statuses: statuses as string[] }));

describe('Property 14: Picker and action visibility', () => {
  it('pickerMachines returns exactly the On Hire machines, in order', () => {
    fc.assert(
      fc.property(listArb, ({ machines, statuses }) => {
        const map = new Map(machines.map((m, i) => [m.id, statuses[i]]));
        const out = pickerMachines(machines, (id) => map.get(id) ?? '');
        const expected = machines.filter((m) => map.get(m.id) === 'On Hire');
        expect(out.map((m) => m.id)).toEqual(expected.map((m) => m.id));
      }),
      { numRuns: 100 },
    );
  });

  it('canInitiate is true iff status is On Hire and the app is active', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constantFrom(...STATUSES), fc.string({ maxLength: 12 })),
        fc.boolean(),
        (status, active) => {
          expect(canInitiate(status, active)).toBe(status === 'On Hire' && active);
        },
      ),
      { numRuns: 100 },
    );
  });
});
