// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { gateService } from '@/services/services';
import { useGateStore } from '@/store/gateStore';

const STATUSES = ['Pending', 'Approved', 'Completed', 'Rejected', ''];

async function create(data: Record<string, unknown>): Promise<Record<string, unknown>> {
  useGateStore.setState({ entries: [] });
  const p = gateService.create(data) as unknown as Promise<Record<string, unknown>>;
  await vi.advanceTimersByTimeAsync(1000); // delay() uses setTimeout
  return p;
}

// Feature: gate-in-qr-scan, Property 11: Gate service honours supplied identity and forces Pending
// **Validates: Requirements 9.7, 9.8, 9.9**
describe('Property 11: gateService.create', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useGateStore.setState({ entries: [], seedMarkers: {}, legacyImported: true });
  });
  afterEach(() => vi.useRealTimers());

  it('keeps supplied id and reference and forces Pending', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.constantFrom(...STATUSES),
        async (id, reference, status) => {
          const out = await create({ id, reference, status, truckPlate: 'X' });
          expect(out.id).toBe(id);
          expect(out.reference).toBe(reference);
          expect(out.status).toBe('Pending');
          const stored = useGateStore.getState().entries.find((r) => r.id === id);
          expect(stored?.reference).toBe(reference);
          expect(stored?.status).toBe('Pending');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('generates non-empty id and reference when not supplied', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...STATUSES), async (status) => {
        const out = await create({ status, truckPlate: 'X' });
        expect(typeof out.id).toBe('string');
        expect((out.id as string).length).toBeGreaterThan(0);
        expect(typeof out.reference).toBe('string');
        expect((out.reference as string).length).toBeGreaterThan(0);
        expect(out.status).toBe('Pending');
        const stored = useGateStore.getState().entries.find((r) => r.id === out.id);
        expect(stored?.reference).toBe(out.reference);
      }),
      { numRuns: 100 },
    );
  });
});
