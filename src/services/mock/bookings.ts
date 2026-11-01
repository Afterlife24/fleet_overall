import { Booking } from '@/types/booking';
import { branches, makeEntity } from './branches';
import { customers } from './customers';
import { machines } from './machines';
import { pick, randInt, randFloat, daysAgoISO, daysAheadISO, NOW_ISO } from './_gen';

// REF-08 Planner — Booking fields
// Period codes: M/W/D/2D/1D
// Legal dispatch gates: quoted, haSent, haReceived
// + site contact, LPO, salesRep, paymentTerms, remarks

const PERIODS = ['M', 'W', 'D', '2D', '1D'] as const;
const TIMES   = ['AM', 'PM', 'Specific'] as const;
const REPS    = ['BG', 'AD', 'CH', 'AM', 'SM', 'SK', 'TD', 'SH', 'MT'] as const;
const PT      = ['30', '45', '60', '90', 'Cash Advance', 'PDC'] as const;

// Synthetic site names (§0 rule)
const SITES = [
  'Dubai Marina - Site 12', 'Downtown Dubai - Tower A', 'DIFC - Gate Village',
  'Abu Dhabi Corniche - Block 3', 'Yas Island - Plot 7', 'Al Reem Island Site',
  'Sharjah Industrial Area 12', 'Fujairah Port Area', 'Mussafah - Zone M4',
  'Al Taweela Industrial', 'Oil Field Camp Alpha', 'Riyadh Industrial City 2',
];

// Site contacts (synthetic)
const CONTACT_NAMES = ['Virat', 'Rohit', 'Steve', 'Kane', 'Joe', 'Ben', 'David', 'Pat'];

function genLPO(): string {
  return `LPO-${randInt(10000, 99999)}`;
}

const syntheticBookings: Booking[] = Array.from({ length: 12 }, (_, i) => {
  const machine   = pick(machines.filter((m) => m.status !== 'Offline'));
  const branch    = branches.find((b) => b.id === machine.branchId) ?? branches[0];
  const customer  = pick(customers);
  const startDate = daysAheadISO(randInt(-10, 20));
  const duration  = randInt(1, 90);
  const endDate   = new Date(new Date(startDate).getTime() + duration * 86400000).toISOString();
  const period    = pick([...PERIODS] as string[]);
  const time      = pick([...TIMES] as string[]) as 'AM' | 'PM' | 'Specific';
  const dailyRate = randFloat(350, 1800, 0);
  const rep       = pick([...REPS] as string[]);
  const pt        = pick([...PT] as string[]);

  // REF-08 legal dispatch gates
  const quoted    = randInt(0, 3) > 0;          // most are quoted
  const haSent    = quoted && randInt(0, 3) > 0; // most quoted have HA sent
  const haReceived= haSent && randInt(0, 2) > 0; // some have signed HA back

  return {
    ...makeEntity(`bk-${i + 1}`),
    reference: `BK-${new Date().getFullYear()}-${String(i + 1).padStart(4, '0')}`,
    customerId:   customer.id,
    customerName: customer.name,
    machineId:    machine.id,
    assetNumber:  machine.assetNumber,
    machineModel: `${machine.make} ${machine.model}`,
    branchId:     branch.id,
    branchName:   branch.name,
    startDate,
    endDate,
    status: pick(['Draft', 'Pending Approval', 'Approved', 'Allocated', 'On Hire', 'Returned']) as any,

    // ── REF-08 booking fields ──
    period,                                       // Period M/W/D/2D/1D
    time,                                         // Time AM/PM/Specific
    specificTime: time === 'Specific' ? `${randInt(6, 20)}:00` : undefined,
    deliveryAddress: pick(SITES),                 // Site
    siteContactName: pick(CONTACT_NAMES),         // Site contact name (§9.2)
    siteContactPhone: `+971 5${randInt(0, 9)} ${randInt(100, 999)} ${randInt(1000, 9999)}`,

    // REF-08 legal dispatch gates
    quoted,                                       // QT'd
    haSent,                                       // HA sent
    haReceived,                                   // Recd? (signed HA received)
    reserved: randInt(0, 4) === 0,                // Reserved

    // Commercial
    dailyRate,
    totalValue: dailyRate * duration,
    lpoNumber:  haSent ? genLPO() : undefined,    // LPO
    lpoValidityDate: haSent ? daysAheadISO(randInt(30, 365)) : undefined, // LPO Validity
    salesRep:   rep,                              // Sales Rep
    paymentTerms: pt,                             // PT
    remarks: pick(['', '', 'Operator required', 'Night delivery', 'Site access permit needed', 'Long-term hire', '']),

    // Kept for display
    contactPhone: customer.phone,
    operatorRequired: randInt(0, 1) === 1,
    notes: pick(['', 'Customer requests morning delivery', 'IPAF 3b certified operator required', '']),
  };
});

// ═══════════════════════════════════════════════════════════════════════════════
// USE SYNTHETIC DEMO DATA (Default)
// ═══════════════════════════════════════════════════════════════════════════════

export const bookings = syntheticBookings;  // USE DEMO DATA

// To switch to real Excel data, uncomment:
// import { realBookings } from './realData';
// export const bookings = realBookings;

export function getBookingById(id: string): Booking | undefined {
  return bookings.find((b) => b.id === id);
}

export function getBookingsForMachine(machineId: string): Booking[] {
  return bookings.filter((b) => b.machineId === machineId);
}
