import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildGateRecordFields } from '@/services/gateCore';
import { buildQrPayload, type MachineLite } from '@/services/collectionCore';
import { demoGateSeedsForOrg, gateSeedId } from '@/services/mock/demoGate';
import { demoMachineId } from '@/services/mock/demoHireLink';

// Feature: gate-in-qr-scan, Property 23: Seed records are well formed
// **Validates: Requirements 15.2, 15.3, 15.6, 15.7**

const FLEET = ['J101', 'J102', 'J103', 'J104', 'J105'];
const orgArb = fc.stringMatching(/^org-[a-z0-9]{1,8}$/);
const startArb = fc
  .date({ min: new Date('2024-01-01T00:00:00Z'), max: new Date('2035-12-31T00:00:00Z'), noInvalidDate: true })
  .map((d) => d.toISOString().slice(0, 10));

const machinesFor = (orgId: string): MachineLite[] =>
  FLEET.map((f, i) => ({ orgId, id: demoMachineId(orgId, i + 1), fleetNo: f, assetNumber: f, make: 'CAT', model: '320' }));

const DAY = 86400000;

describe('Property 23: Seed records are well formed', () => {
  it('ids, references, row rules and timestamps hold for any company and start date', () => {
    fc.assert(
      fc.property(orgArb, startArb, (orgId, start) => {
        const machines = machinesFor(orgId);
        const rows = demoGateSeedsForOrg(orgId, { machines, booking: { id: 'bk-demo-5', startDate: start, customerName: 'MNO Company LLC' } });
        expect(rows).toHaveLength(3);
        rows.forEach((r, i) => {
          expect(r.id).toBe(`ge-demo-${orgId}-${i + 1}`);
          expect(r.id).toBe(gateSeedId(orgId, i + 1));
          expect(r.reference).toBe(`GP-DEMO-${i + 1}`);
          expect(r.seedKey).toBe(r.id);
          expect(r.orgId).toBe(orgId);
          expect(r.gateTimeZone).toBe('Asia/Dubai');
          expect(r.createdAt).toBe(r.timestamp);
          expect(r.updatedAt).toBe(r.timestamp);
        });
        expect(new Set(rows.map((r) => r.id)).size).toBe(3);

        const [r1, r2, r3] = rows;
        expect(r1).toMatchObject({ fleetNo: 'J105', direction: 'OUT', status: 'Completed', captureMethod: 'Manual', customer: 'MNO Company LLC' });
        expect(r1.notes).toContain('bk-demo-5');
        const gap = Date.parse(`${start}T00:00:00.000Z`) - Date.parse(r1.timestamp);
        expect(gap).toBeGreaterThanOrEqual(1 * DAY);
        expect(gap).toBeLessThanOrEqual(7 * DAY);

        const j104 = machines[3];
        const f = buildGateRecordFields('2026-11-28T10:20:00.000Z', 'Asia/Dubai', j104, 'QR', 'server', buildQrPayload(j104));
        expect(r2).toMatchObject({ ...f, direction: 'IN', status: 'Completed', machineId: j104.id });
        expect(r2.gateDate).toBe('2026-11-28');
        expect(r2.gateTime).toMatch(/^\d{2}:\d{2}:\d{2}$/);

        expect(r3).toMatchObject({ fleetNo: 'J101', direction: 'OUT', status: 'Pending', timestamp: '2026-12-01T05:00:00.000Z' });
      }),
      { numRuns: 100 },
    );
  });

  it('ids are disjoint across companies', () => {
    fc.assert(
      fc.property(orgArb, orgArb, (a, b) => {
        fc.pre(a !== b);
        const ids = (o: string) => demoGateSeedsForOrg(o, { machines: machinesFor(o), booking: { id: 'bk', startDate: '2026-12-10' } }).map((r) => r.id);
        const other = new Set(ids(b));
        expect(ids(a).some((id) => other.has(id))).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
