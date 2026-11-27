import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { planInitiate, type InitiateInput } from '@/services/collectionCore';
import type { MissingLink, ReferenceFields } from '@/types/collection';

const str = fc.string({ maxLength: 12 });
const missingArb = fc.subarray<MissingLink>(['BOOKING', 'AGREEMENT', 'QUOTATION', 'INVOICE']);

const refsArb: fc.Arbitrary<ReferenceFields> = fc.record({
  machineId: str,
  fleetNo: str,
  machineDescription: str,
  serialNumber: str,
  customerName: str,
  customerId: str,
  bookingId: str,
  bookingRef: str,
  hireAgreementId: str,
  hireAgreementNo: str,
  quotationId: str,
  quotationNo: str,
  invoiceId: str,
  invoiceNo: str,
  site: str,
  missing: missingArb,
  refNotes: fc.array(str, { maxLength: 4 }),
});

const statusArb = fc.oneof(
  fc.constant('On Hire'),
  fc.constantFrom('Available', 'Maintenance', 'Reserved', 'Off Hire', 'on hire', ''),
  str,
);

const inputArb: fc.Arbitrary<InitiateInput> = fc
  .record({
    orgId: fc.string({ minLength: 1, maxLength: 8 }),
    machineOrgSame: fc.constant(true),
    status: statusArb,
    mqdActive: fc.boolean(),
    tpsActive: fc.boolean(),
    transportActive: fc.boolean(),
    date: fc.constant('2026-03-01'),
    year: fc.integer({ min: 2020, max: 2099 }),
    ids: fc.record({
      cn: fc.string({ minLength: 1, maxLength: 8 }).map((s) => `cn-${s}`),
      mqd: fc.string({ minLength: 1, maxLength: 8 }).map((s) => `mqd-${s}`),
      tps: fc.string({ minLength: 1, maxLength: 8 }).map((s) => `tps-${s}`),
    }),
    refs: refsArb,
    machineId: fc.string({ minLength: 1, maxLength: 8 }),
  })
  .map(({ machineId, machineOrgSame: _s, ...r }) => ({
    ...r,
    machine: { id: machineId, orgId: r.orgId, assetNumber: 'A1' },
  }));

const numbers = { cn: 'CN-2026-0001', mqd: 'MQD-2026-0001', tps: 'TPS-2026-0001' };

describe('planInitiate', () => {
  // Feature: offhire-collection-docs, Property 13: Initiate plan
  // **Validates: Requirements 1.1, 1.2, 1.8, 1.9, 1.12**
  it('fails NOT_ON_HIRE unless On Hire; otherwise plans the right document set', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const plan = planInitiate(input, numbers);
        if (input.status !== 'On Hire') {
          expect(plan).toEqual({ ok: false, error: 'NOT_ON_HIRE' });
          return;
        }
        expect(plan.ok).toBe(true);
        if (!plan.ok) return;

        expect(plan.cn.status).toBe('Draft');
        expect(plan.cn.signedStatus).toBe('Pending');
        expect(plan.cn.number).toBe(numbers.cn);
        expect(plan.cn.id).toBe(input.ids.cn);

        expect(plan.mqd !== undefined).toBe(input.mqdActive);
        expect(plan.tps !== undefined).toBe(input.tpsActive);

        const expectedSkipped: ('MQD' | 'TPS')[] = [];
        if (!input.mqdActive) expectedSkipped.push('MQD');
        if (!input.tpsActive) expectedSkipped.push('TPS');
        expect([...plan.skipped].sort()).toEqual(expectedSkipped.sort());
        expect(plan.transport).toBe(input.transportActive);

        const expectedIds = {
          cnId: input.ids.cn,
          mqdId: input.mqdActive ? input.ids.mqd : '',
          tpsId: input.tpsActive ? input.ids.tps : '',
        };
        const created = [plan.cn, plan.mqd, plan.tps].filter((d) => d !== undefined);
        for (const d of created) {
          expect(d.cnId).toBe(expectedIds.cnId);
          expect(d.mqdId).toBe(expectedIds.mqdId);
          expect(d.tpsId).toBe(expectedIds.tpsId);
          expect(d.signedStatus).toBe('Pending');
          expect(d.refNotes).toEqual(input.refs.refNotes);
          expect(d.missing).toEqual(input.refs.missing);
        }
        if (plan.mqd) expect(plan.mqd.number).toBe(numbers.mqd);
        if (plan.tps) expect(plan.tps.number).toBe(numbers.tps);
      }),
      { numRuns: 150 },
    );
  });

  it('fails WRONG_ORG when the machine belongs to another organisation', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const plan = planInitiate(
          { ...input, machine: { ...input.machine, orgId: input.orgId + 'x' } },
          numbers,
        );
        expect(plan).toEqual({ ok: false, error: 'WRONG_ORG' });
      }),
      { numRuns: 100 },
    );
  });
});
