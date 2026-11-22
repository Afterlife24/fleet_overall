import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  kindOfType, mapFormToRecord, toTransportJobView, validateTransportForm,
  TRANSPORT_SALES, TRANSPORT_SHIFTS, TRANSPORT_TYPES, type MachineRef,
} from '../transportCore';
import { formArb, machineArb } from './transportCore.arbs';

const FIELDS = [
  'plannerName', 'date', 'shift', 'transportTeam', 'srNo', 'fleet', 'from', 'to',
  'transport', 'type', 'contact', 'sales', 'client', 'time',
] as const;

// Feature: rental-flow-integration, Property 2: Transport form mapping
// **Validates: Requirements 1.1, 1.3, 1.13**
describe('Property 2: Transport form mapping', () => {
  it('stores the 15 fields unchanged and maps them to the view', () => {
    fc.assert(
      fc.property(formArb, fc.array(machineArb, { maxLength: 4 }), fc.boolean(), (form, machines, withMatch) => {
        const list: MachineRef[] = withMatch && machines.length > 0
          ? [{ ...machines[0], fleetNo: form.fleet }, ...machines.slice(1)]
          : machines.filter((m) => m.fleetNo !== form.fleet && m.assetNumber !== form.fleet);
        const rec = mapFormToRecord(form, {
          orgId: 'org-x', id: 'tj-1', ref: 'TJ-2026-0001', now: '2026-03-01T10:00:00.000Z', machines: list,
        });
        expect(rec.status).toBe('Scheduled');
        expect(rec.orgId).toBe('org-x');
        expect(rec.id).toBe('tj-1');
        for (const k of FIELDS) expect(rec[k]).toEqual(form[k]);
        expect(rec.remarks).toEqual(form.remarks);

        const v = toTransportJobView(rec, { machines: list });
        expect(v.origin).toBe(form.from);
        expect(v.destination).toBe(form.to);
        expect(v.assetNumber).toBe(form.fleet);
        expect(v.truckRegistration).toBe(form.transport);
        expect(v.type).toBe(kindOfType(form.type));
        expect(v.scheduledTime).toBe(`${form.date}T${form.time}:00`);
        expect(v.distance).toBeUndefined();
        const m = list.find((x) => x.fleetNo === form.fleet) ?? list.find((x) => x.assetNumber === form.fleet);
        if (m) {
          expect(v.machineId).toBe(m.id);
          expect(rec.machineId).toBe(m.id);
          expect(v.machineModel).toBe(`${m.make} ${m.model}`.trim());
        } else {
          expect(v.machineId).toBe('');
          expect(v.machineModel).toBe('');
        }
      }),
      { numRuns: 100 },
    );
  });

  it('maps the type letter to a kind (D, O, T/T2)', () => {
    expect(kindOfType('D')).toBe('Delivery');
    expect(kindOfType('O')).toBe('Collection');
    expect(kindOfType('T')).toBe('Transfer');
    expect(kindOfType('T2')).toBe('Transfer');
  });

  it('toTransportJobView never throws, even for partial or odd records', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.constantFrom(...FIELDS, 'id', 'status', 'orgId', 'time', 'date'), fc.anything()), (junk) => {
        const v = toTransportJobView(junk as never, { machines: [] });
        expect(typeof v.reference).toBe('string');
        expect(typeof v.destination).toBe('string');
      }),
      { numRuns: 100 },
    );
  });
});

const valid = (f: unknown) => validateTransportForm(f);

// Feature: rental-flow-integration, Property 3: Transport form validation
// **Validates: Requirements 1.9**
describe('Property 3: Transport form validation', () => {
  it('accepts every valid form', () => {
    fc.assert(
      fc.property(formArb, (form) => {
        const r = valid(form);
        expect(r.ok).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('reports an error for exactly the invalid fields', () => {
    const badText = fc.constantFrom('', '   ', undefined, null, 5);
    const badSr = fc.constantFrom(0, -1, 10000, 1.5, Number.NaN, '5', undefined);
    fc.assert(
      fc.property(
        formArb,
        fc.subarray([...FIELDS], { minLength: 1 }),
        badText,
        badSr,
        fc.string({ minLength: 1, maxLength: 4 }).filter((s) => !(TRANSPORT_TYPES as readonly string[]).includes(s)
          && !(TRANSPORT_SHIFTS as readonly string[]).includes(s) && !(TRANSPORT_SALES as readonly string[]).includes(s)),
        (form, broken, bt, bs, badEnum) => {
          const input: Record<string, unknown> = { ...form };
          for (const k of broken) {
            if (k === 'srNo') input[k] = bs;
            else if (k === 'shift' || k === 'type' || k === 'sales') input[k] = badEnum;
            else input[k] = bt;
          }
          const r = valid(input);
          expect(r.ok).toBe(false);
          if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual([...broken].sort());
        },
      ),
      { numRuns: 100 },
    );
  });

  it('treats remarks as optional', () => {
    const r = valid({ ...fc.sample(formArb, 1)[0], remarks: undefined });
    expect(r.ok).toBe(true);
  });
});
