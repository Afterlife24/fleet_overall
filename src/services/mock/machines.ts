import { Machine, MachineStatus, PowerSource, MachineDocument, RepairRecord } from '@/types/machine';
import { TimelineEvent } from '@/types/common';
import { branches, makeEntity } from './branches';
import { randInt, randFloat, pick, daysAgoISO, daysAheadISO, NOW_ISO, randId } from './_gen';

// REF-09 machine specs — Model, Type (B/S/PL/CB), Energy (D/E/Bi/H), WH (working height m)
const MAKES_MODELS = [
  { make: 'JLG',      model: '660SJ',    type: 'B',  energy: 'D',  wh: 22.1 },
  { make: 'JLG',      model: '800AJ',    type: 'B',  energy: 'D',  wh: 26.2 },
  { make: 'JLG',      model: '1350SJP',  type: 'B',  energy: 'D',  wh: 43.2 },
  { make: 'JLG',      model: '860SJ',    type: 'B',  energy: 'D',  wh: 28.2 },
  { make: 'Genie',    model: 'S-65',     type: 'B',  energy: 'D',  wh: 21.6 },
  { make: 'Genie',    model: 'S-85 XC',  type: 'B',  energy: 'D',  wh: 28.2 },
  { make: 'Genie',    model: 'Z-135',    type: 'B',  energy: 'D',  wh: 43.2 },
  { make: 'Haulotte', model: 'H23TPX',   type: 'B',  energy: 'D',  wh: 23.0 },
  { make: 'JLG',      model: '3246ES',   type: 'S',  energy: 'E',  wh: 11.7 },
  { make: 'JLG',      model: '4069LE',   type: 'S',  energy: 'E',  wh: 14.0 },
  { make: 'Skyjack',  model: 'SJ6826RT', type: 'S',  energy: 'D',  wh: 10.1 },
  { make: 'Genie',    model: 'GS-3246',  type: 'S',  energy: 'E',  wh: 11.7 },
  { make: 'Haulotte', model: 'H15SXL',   type: 'S',  energy: 'E',  wh: 15.1 },
  { make: 'Genie',    model: 'GR-20',    type: 'PL', energy: 'E',  wh: 8.0  },
  { make: 'JLG',      model: '1644',     type: 'CB', energy: 'D',  wh: 16.0 },
  { make: 'Manitou',  model: 'MT 1840',  type: 'CB', energy: 'D',  wh: 18.0 },
];

// REF-09 Site — exactly 6 regions (Joe Keely rule)
const SITES = ['Dubai', 'Abu Dhabi', 'Taweelah', 'Oilfields', 'Fujairah', 'KSA'] as const;

// REF-09 REP codes
const REPS = ['BG', 'AD', 'CH', 'AM', 'SM', 'SK', 'TD', 'SH', 'MT'] as const;

// REF-09 PT (payment terms)
const PAYMENT_TERMS = ['30', '45', '60', '90', 'Cash Advance', 'PDC'] as const;

// REF-09 Period codes
const PERIODS = ['D', 'W', 'M', '2D', '1D'] as const;

// REF-09 Status codes — mapped to existing MachineStatus type
const STATUSES = ['Available', 'On Hire', 'PHI', 'PDI', 'In Workshop', 'Under Repair', 'Transport', 'Breakdown', 'Offline'] as MachineStatus[];

// REF-09 Clients (synthetic — no real client names per §0 rule)
const CLIENTS = [
  'Client A', 'Client B', 'Client C', 'Client D', 'Client E',
  'Client F', 'Client G', 'Client H', 'Client I', 'Client J',
];

function weightedStatus(): MachineStatus {
  const weights: [MachineStatus, number][] = [
    ['Available', 28], ['On Hire', 35], ['Under Repair', 10],
    ['PHI', 6], ['PDI', 5], ['In Workshop', 6], ['Transport', 5],
    ['Breakdown', 3], ['Offline', 2],
  ];
  const total = weights.reduce((s, [, w]) => s + w, 0);
  let r = randFloat(0, total, 2);
  for (const [s, w] of weights) {
    r -= w;
    if (r <= 0) return s;
  }
  return 'Available';
}

function genDocuments(): MachineDocument[] {
  const types: MachineDocument['type'][] = ['Registration', 'Insurance', 'Certificate', 'Manual', 'Permit'];
  return Array.from({ length: randInt(2, 4) }, () => ({
    id: `doc-${randId()}`,
    name: `${pick(types)} - ${new Date().getFullYear()}`,
    type: pick(types),
    uploadedAt: daysAgoISO(randInt(30, 500)),
    expiryDate: daysAheadISO(randInt(10, 365)),
    size: `${randInt(120, 4500)} KB`,
  }));
}

function genRepairHistory(): RepairRecord[] {
  return Array.from({ length: randInt(0, 4) }, () => ({
    id: `rep-${randId()}`,
    date: daysAgoISO(randInt(30, 800)),
    description: pick([
      'Hydraulic oil leak repaired',
      'Battery replacement',
      'Boom control valve overhaul',
      'Tire replacement — all four',
      'Engine service and filter change',
      'Platform level sensor replaced',
      'Emergency stop circuit repair',
      'Drive motor brush replacement',
    ]),
    technician: pick(['Ravindra Jadeja', 'Hardik Pandya', 'Glenn Maxwell', 'Ben Stokes']),
    cost: randFloat(450, 8500, 0),
    bay: `Bay ${pick(['A', 'B', 'C', 'D'])}-${randInt(1, 3)}`,
    durationHours: randFloat(1.5, 24, 1),
  })).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

function genTimeline(status: MachineStatus): TimelineEvent[] {
  return Array.from({ length: randInt(3, 6) }, (_, i) => ({
    id: `tl-${randId()}`,
    timestamp: daysAgoISO(i * randInt(3, 20)),
    title: pick([
      'Machine checked in at gate',
      'PDI inspection completed',
      'Allocated to customer booking',
      'Transport dispatched',
      'PHI inspection passed',
      'Breakdown reported',
      'Repair completed and released',
      'Transferred between branches',
    ]),
    description: pick(['No issues found', 'Minor adjustment made', 'Parts ordered', '']),
    actor: pick(['System', 'Ravindra Jadeja', 'Ben Stokes', 'Steve Smith']),
    type: pick(['info', 'success', 'warning', 'maintenance']) as TimelineEvent['type'],
  })).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

// REF-09 LPO number format
function genLPO(): string {
  return `LPO-${randInt(10000, 99999)}`;
}

// REF-09 HA (Hire Agreement) reference
function genHA(): string {
  return `HA-${new Date().getFullYear()}-${randInt(1000, 9999)}`;
}

/**
 * Deterministic TPC expiry offset (in days from today) based on machine index.
 *
 * Does NOT use the random generator, so the distribution is identical on every
 * build and environment (local === production) for a given load date.
 *
 * Each block of 10 machines has exactly 5 working : 2 warning : 3 expired, but
 * the tiers are SHUFFLED within the block (not sequential) so the list looks
 * naturally mixed. The pattern is fixed, so it's stable across builds.
 *
 *   offset > 30  → WORKING (green)
 *   0 … 30       → WARNING (yellow/orange/red near-expiry)
 *   < 0          → EXPIRED (red)
 */
// Fixed, pre-shuffled offsets for one block of 10 machines.
// Contains exactly: 5 working (>30d), 2 warning (0–30d), 3 expired (<0d).
const TPC_BLOCK_OFFSETS = [
  -18,   // expired
  120,   // working
  25,    // warning
  85,    // working
  -32,   // expired
  60,    // working
  -5,    // expired
  150,   // working
  12,    // warning
  95,    // working
];

function tpcOffsetForIndex(i: number): number {
  return TPC_BLOCK_OFFSETS[i % 10];
}

const syntheticMachines: Machine[] = (Array.from({ length: 20 }, (_, i) => {
  const spec = pick(MAKES_MODELS);
  const branch = pick(branches);
  const status = weightedStatus();
  const isOnHire = status === 'On Hire';
  const year = randInt(2018, 2024);
  const site = pick([...SITES] as string[]);
  const client = isOnHire ? pick(CLIENTS) : undefined;
  const rate = randFloat(800, 5500, 0);          // Monthly rate AED
  const costToRepair = randFloat(500, 15000, 0);
  const payBack = parseFloat((costToRepair / rate).toFixed(2)); // months to pay back

  // REF-09 Fleet No format — e.g. J116, matching example in spec
  const fleetNo = `J${String(100 + i + 1)}`;

  return {
    ...makeEntity(`mc-${i + 1}`),

    // ── REF-09 identity fields ──
    fleetNo,                                        // Fleet No (e.g. J116)
    assetNumber: fleetNo,                           // keep assetNumber in sync for display
    serialNumber: `SN${randInt(100000000, 999999999)}`,
    make: spec.make,
    model: spec.model,
    type: spec.type as 'B' | 'S' | 'PL' | 'CB',
    energy: spec.energy as 'D' | 'E' | 'Bi' | 'H',
    wh: spec.wh,
    category: spec.type === 'B' ? 'Telescopic Boom' : spec.type === 'S' ? 'Scissor Lift' : spec.type === 'CB' ? 'Telehandler' : 'Vertical Mast',
    status,
    branchId: branch.id,
    branchName: branch.name,
    siteRegion: pick([...SITES] as string[]),
    specific: isOnHire ? `Site ${randInt(1, 30)}` : 'Yard',

    // ── Hire Details (REF-09) ──
    client,                                         // Client
    suppInLieu: randInt(0, 10) === 0 ? `J${randInt(100, 999)}` : undefined, // Supp In Lieu For
    rate,                                           // Rate (AED monthly)
    period: isOnHire ? pick([...PERIODS] as string[]) : undefined,
    dailyRevenue: isOnHire ? parseFloat((rate / 26).toFixed(0)) : undefined, // Daily Revenue (÷26 working days)
    mobDemob: isOnHire ? `${randFloat(200, 800, 0)} AED` : undefined,       // Mob/Demob
    ha: isOnHire ? genHA() : undefined,             // H/A (Hire Agreement)
    startDate: isOnHire ? daysAgoISO(randInt(1, 180)) : undefined,          // Start Date
    endDate: isOnHire ? daysAheadISO(randInt(1, 180)) : undefined,           // End Date
    endDateHaSigned: isOnHire ? daysAgoISO(randInt(1, 10)) : undefined,     // End Date HA Signed
    rep: pick([...REPS] as string[]),
    pt: pick([...PAYMENT_TERMS] as string[]),
    lpo: isOnHire ? genLPO() : undefined,           // LPO number
    lpoValidity: isOnHire ? daysAheadISO(randInt(30, 365)) : undefined,     // LPO Validity

    // ── TPC Certificate (REF-09) — Third Party Certification, expires every 6 months ──
    // Deterministic offset by index → identical expired/near-expiry counts on local & production
    tpcExpiryDate: daysAheadISO(tpcOffsetForIndex(i)), // TPC Expiry Date
    tpcSupplier: pick(['Bureau Veritas', 'SGS UAE', 'Intertek', 'TUV Rheinland', 'DNV GL']), // TPC Supplier

    // ── Repair Economics (REF-09 / REF-05) ──
    hoursToRepair: randFloat(2, 80, 1),             // Hours to Repair
    costToRepair,                                   // Cost to Repair (AED)
    payBack,                                        // Pay Back (months)

    // ── Kept for UI display ──
    powerSource: (spec.energy === 'D' ? 'Diesel' : spec.energy === 'E' ? 'Electric' : spec.energy === 'Bi' ? 'Bi-Energy' : 'Hybrid') as PowerSource,
    platformHeight: spec.wh - 6,
    workingHeight: spec.wh,
    capacity: randInt(200, 5000),
    year,
    hoursOperated: randInt(50, 12000),
    doa: daysAgoISO(randInt(180, 2000)),            // DOA — Date of Arrival
    supplier: pick(['JLG Industries', 'Genie Industries', 'Skyjack', 'Haulotte', 'Manitou']),
    lastInspection: daysAgoISO(randInt(1, 120)),
    nextInspection: daysAheadISO(randInt(1, 90)),
    nextPHI: daysAheadISO(randInt(1, 180)),
    nextMandatory: daysAheadISO(randInt(1, 60)),
    location: isOnHire ? `${pick([...SITES] as string[])} - Site ${randInt(1, 30)}` : `${branch.name} - Yard`,
    currentCustomer: client,
    repairHistory: genRepairHistory(),
    timeline: genTimeline(status),
    remarks: pick(['', '', '', 'Awaiting parts', 'Under warranty', 'Customer long-term hire', '']),
    updatedAt: NOW_ISO(),
  };
})) as unknown as Machine[];

// ═══════════════════════════════════════════════════════════════════════════════
// USE SYNTHETIC DEMO DATA (Default)
// ═══════════════════════════════════════════════════════════════════════════════

export const machines = syntheticMachines;  // USE DEMO DATA

// To switch to real Excel data, uncomment:
// import { realMachines } from './realData';
// export const machines = realMachines;

export function getMachineById(id: string): Machine | undefined {
  return machines.find((m) => m.id === id);
}

export function getMachineByAsset(asset: string): Machine | undefined {
  return machines.find((m) => m.assetNumber === asset);
}
