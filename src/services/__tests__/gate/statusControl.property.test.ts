import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { collectionStatusControl } from '@/services/collectionCore';
import type { CollectionStatus } from '@/types/collection';

// Feature: gate-in-qr-scan, Property 26: Collected is never selectable
// **Validates: Requirements 16.1, 16.3, 16.4**
describe('Property 26: collectionStatusControl', () => {
  it('never offers Collected and is read-only exactly for Collected and Closed', () => {
    fc.assert(
      fc.property(fc.constantFrom<CollectionStatus>('Draft', 'Scheduled', 'Collected', 'Closed'), (s) => {
        const c = collectionStatusControl(s);
        expect(c.options).not.toContain('Collected');
        expect(c.readOnly).toBe(s === 'Collected' || s === 'Closed');
        if (s === 'Collected') expect(c.options).toEqual(['Closed']);
        if (s === 'Closed') expect(c.options).toEqual([]);
        if (s === 'Draft' || s === 'Scheduled') expect([...c.options].sort()).toEqual(['Draft', 'Scheduled']);
      }),
      { numRuns: 100 },
    );
  });
});
