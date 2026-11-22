import fc from 'fast-check';
import type { TransportForm, TransportJobRecord, TransportJob } from '@/types/transport';
import {
  TRANSPORT_SALES, TRANSPORT_SHIFTS, TRANSPORT_TYPES, type MachineRef,
} from '../transportCore';

const word = fc
  .array(fc.constantFrom('a', 'b', 'c', 'D', 'E', '1', '2', '-'), { minLength: 1, maxLength: 8 })
  .map((a) => a.join(''));

export const formArb: fc.Arbitrary<TransportForm> = fc.record(
  {
    plannerName: word,
    date: fc.constantFrom('2026-01-05', '2026-06-30', '2027-12-01'),
    shift: fc.constantFrom(...TRANSPORT_SHIFTS),
    transportTeam: word,
    srNo: fc.integer({ min: 1, max: 9999 }),
    fleet: word,
    from: word,
    to: word,
    transport: word,
    type: fc.constantFrom(...TRANSPORT_TYPES),
    contact: word,
    sales: fc.constantFrom(...TRANSPORT_SALES),
    client: word,
    time: fc.constantFrom('08:00', '13:45', '23:59'),
    remarks: fc.string({ maxLength: 20 }),
  },
  { requiredKeys: ['plannerName', 'date', 'shift', 'transportTeam', 'srNo', 'fleet', 'from', 'to', 'transport', 'type', 'contact', 'sales', 'client', 'time'] },
);

export const machineArb: fc.Arbitrary<MachineRef> = fc.record({
  id: word,
  fleetNo: fc.option(word, { nil: undefined }),
  assetNumber: word,
  make: word,
  model: word,
  branchId: word,
  branchName: word,
});

const STATUSES = ['Scheduled', 'Loading', 'In Transit', 'Delivered', 'Returning', 'Completed', 'Cancelled'] as const;

export const isoArb = fc
  .integer({ min: Date.UTC(2026, 0, 1), max: Date.UTC(2026, 11, 31) })
  .map((t) => new Date(t).toISOString());

export const recordArb = (orgId: string): fc.Arbitrary<TransportJobRecord> =>
  fc
    .tuple(formArb, fc.constantFrom(...STATUSES), isoArb, fc.nat(100000))
    .map(([f, status, createdAt, n]) => ({
      ...f,
      id: `tj-${n}`,
      orgId,
      reference: `TJ-2026-${String((n % 9999) + 1).padStart(4, '0')}`,
      status,
      createdAt,
      updatedAt: createdAt,
    }));

export const mockJobArb: fc.Arbitrary<TransportJob> = fc
  .tuple(fc.nat(100000), fc.constantFrom(...STATUSES), fc.constantFrom('Delivery', 'Collection', 'Transfer' as const), isoArb)
  .map(([n, status, type, createdAt]) => ({
    id: `tj-mock-${n}`,
    createdAt,
    updatedAt: createdAt,
    reference: `TJ-MOCK-${n}`,
    machineId: 'm',
    assetNumber: 'A',
    machineModel: 'M',
    branchId: 'b',
    branchName: 'B',
    driverId: 'd',
    driverName: 'D',
    truckId: 't',
    truckRegistration: 'T',
    origin: 'O',
    destination: 'D-1',
    scheduledTime: createdAt,
    status,
    distance: 10,
    type: type as TransportJob['type'],
    chargeToCustomer: 0,
    internalCost: 0,
  }));
