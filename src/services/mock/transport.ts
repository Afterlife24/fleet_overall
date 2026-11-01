import { Driver, Truck, TransportJob } from '@/types/transport';
import { branches, makeEntity } from './branches';
import { machines } from './machines';
import { pick, randInt, randFloat, daysAgoISO, daysAheadISO, NOW_ISO, randName, randPhone } from './_gen';

// REF-13 Transport Schedule — exact 15 fields (4 header + 11 per job)

// REF-13 Planner names
const PLANNER_NAMES = ['Virat', 'Rohit', 'Steve', 'Kane', 'Joe', 'Ben'];

// REF-13 Transport vehicles — 5 trucks (§8.6: 2 AUH + 3 DXB)
export const drivers: Driver[] = Array.from({ length: 5 }, (_, i) => {
  const branch = pick(branches);
  return {
    id: `drv-${i + 1}`,
    name: randName(),
    phone: randPhone(),
    licenseNumber: `DL-${randInt(10000000, 99999999)}`,
    licenseExpiry: daysAheadISO(randInt(30, 700)),
    branchId: branch.id,
    branchName: branch.name,
    status: pick(['Available', 'On Delivery', 'Returning', 'Off Duty']),
    rating: randFloat(3.5, 5, 1),
    totalDeliveries: randInt(50, 900),
  };
});

// REF-13 / §8.6 — 5 trucks: AUH×2 (AUH/Oil&Gas/Al Ain), DXB×3 (DXB/SHJ/AJM/FUJ/RAK/UAQ)
export const trucks: Truck[] = [
  { id: 'trk-auh-1', registration: 'AUH 11111', type: 'Flatbed', capacity: 15, branchId: 'br-auh', branchName: 'Abu Dhabi',  status: 'Available', name: 'MT 1 — AUH (AUH/Oil&Gas/Al Ain)' },
  { id: 'trk-auh-2', registration: 'AUH 22222', type: 'Lowboy',  capacity: 20, branchId: 'br-auh', branchName: 'Abu Dhabi',  status: 'Available', name: 'MT 2 — AUH (AUH/Oil&Gas/Al Ain)' },
  { id: 'trk-dxb-1', registration: 'DXB 33333', type: 'Flatbed', capacity: 15, branchId: 'br-dxb', branchName: 'Dubai',      status: 'Available', name: 'MT 3 — DXB (DXB/SHJ/AJM)' },
  { id: 'trk-dxb-2', registration: 'DXB 44444', type: 'Lowboy',  capacity: 20, branchId: 'br-dxb', branchName: 'Dubai',      status: 'Available', name: 'MT 4 — DXB (DXB/FUJ/RAK/UAQ)' },
  { id: 'trk-dxb-3', registration: 'DXB 55555', type: 'Flatbed', capacity: 15, branchId: 'br-dxb', branchName: 'Dubai',      status: 'Available', name: 'MT 5 — DXB (DXB/SHJ/AJM)' },
] as any[];

// REF-13 Type codes
const TYPES = ['D', 'T', 'O', 'T2'] as const;

// REF-13 Sales rep codes (§8.6)
const SALES_REPS = ['BG', 'AD', 'CH', 'AM', 'SM', 'SK', 'TD', 'SH', 'MT', 'TS'] as const;

// Synthetic client names (§0 rule)
const CLIENTS = [
  'Client A', 'Client B', 'Client C', 'Client D', 'Client E',
  'Client F', 'Client G', 'Client H', 'Client I', 'Client J',
];

// REF-13 locations — realistic UAE site names (synthetic)
const LOCATIONS = [
  'AUH Yard', 'DXB Yard', 'TAW Yard',
  'Dubai Marina Site', 'Downtown Dubai Site', 'DIFC Site',
  'Abu Dhabi Corniche Site', 'Yas Island Site', 'Al Reem Island Site',
  'Sharjah Industrial Site', 'Fujairah Port Site',
  'ADNOC Hostel', 'UM LULU Hostel', 'JiuJitsu Arena',
  'Al Taweela Site', 'Mussafah Site', 'Oil Field Camp',
];

function timeStr(hour: number, minute: number): string {
  const h = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  const ampm = hour >= 12 ? 'PM' : 'AM';
  return `${h}:${String(minute).padStart(2, '0')} ${ampm}`;
}

export const transportJobs: TransportJob[] = Array.from({ length: 8 }, (_, i) => {
  const machine = pick(machines.filter(m => m && m.id && m.branchId));
  if (!machine) return null;
  
  const driver = pick(drivers);
  const truck = pick(trucks);
  const type = pick([...TYPES] as string[]) as 'Delivery' | 'Collection' | 'Transfer';
  const scheduledDate = daysAheadISO(randInt(-2, 7)).split('T')[0];
  const hour = randInt(6, 20);
  const minute = pick([0, 0, 30]);
  const shift = hour < 14 ? 'Morning' : 'Evening';
  const distance = randFloat(5, 450, 1);
  
  // Financial calculation
  const baseRate = randInt(25, 60) * 10; // 250-600 AED base
  const distanceMult = distance < 50 ? 1.0 : distance < 150 ? 1.5 : 2.2;
  const chargeToCustomer = Math.round(baseRate * distanceMult / 10) * 10;
  const costRatio = randFloat(0.7, 1.35, 2); // Some profitable, some at loss
  const internalCost = Math.round(chargeToCustomer * costRatio / 10) * 10;

  return {
    ...makeEntity(`tj-${i + 1}`),
    reference: `TR-${new Date().getFullYear()}-${String(i + 1).padStart(4, '0')}`,

    // ── REF-13 Header fields ──
    plannerName:   pick(PLANNER_NAMES),                  // Planner Name
    date:          scheduledDate,                         // Date
    shift:         shift as 'Morning' | 'Evening',       // Shift
    transportTeam: `${(truck as any).name ?? truck.registration} - ${driver.name}`,

    // ── REF-13 Job fields (11) ──
    srNo:      i + 1,                                    // Sr. No
    fleet:     machine.assetNumber,                      // Fleet
    from:      pick(LOCATIONS),                          // From
    to:        pick(LOCATIONS),                          // To
    transport: (truck as any).name ?? truck.registration,
    type:      type,                                     // Type D/T/O/T2
    contact:   `${randName()} / ${randPhone()}`,          // Contact (name + phone)
    sales:     pick([...SALES_REPS] as string[]),
    client:    pick(CLIENTS),                            // Client
    time:      timeStr(hour, minute),                    // Time (e.g. 9:00 AM)
    remarks:   pick(['TBC', 'Transfer', '', 'Night delivery', 'Escort required', 'Transfer 2', '']), // Remarks

    // ── kept for UI display ──
    machineId:        machine.id,
    assetNumber:      machine.assetNumber,
    machineModel:     `${machine.make} ${machine.model}`,
    branchId:         machine.branchId,
    branchName:       machine.branchName,
    driverId:         driver.id,
    driverName:       driver.name,
    truckId:          truck.id,
    truckRegistration: truck.registration,
    origin:           pick(LOCATIONS),
    destination:      pick(LOCATIONS),
    scheduledTime:    daysAheadISO(randInt(-2, 7)),
    status:           pick(['Scheduled', 'Loading', 'In Transit', 'Delivered', 'Completed']) as any,
    distance,
    updatedAt:        NOW_ISO(),
    
    // ── Financial tracking for TRIPBASE ──
    customerName:      pick(CLIENTS),
    chargeToCustomer,
    internalCost,
  };
}).filter(Boolean) as TransportJob[];  // Remove null entries

export function getDriverById(id: string): Driver | undefined {
  return drivers.find((d) => d.id === id);
}
export function getTruckById(id: string): Truck | undefined {
  return (trucks as any[]).find((t: any) => t.id === id);
}
export function getTransportJobById(id: string): TransportJob | undefined {
  return transportJobs.find((j) => j.id === id);
}
