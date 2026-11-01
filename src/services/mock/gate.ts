import { GateEntry } from '@/types/gate';
import { machines } from './machines';
import { pick, randInt, daysAgoISO, NOW_ISO } from './_gen';

// REF-06 §5.1 Gate Capture — exact 4 fields per entry
// Effect: machine flips IN TRANSIT → IN YARD

// REF-06 arrivingFrom — site/yard picklist
const ARRIVING_FROM = [
  'Yard', 'Dubai', 'Abu Dhabi', 'Taweelah', 'Oilfields', 'Fujairah', 'KSA', 'External',
] as const;

// Truck plates (synthetic)
const TRUCK_PLATES = [
  'DXB 33333', 'DXB 44444', 'DXB 55555',
  'AUH 11111', 'AUH 22222',
  'FUJ 12345', 'SHJ 98765',
];

export const gateEntries: GateEntry[] = Array.from({ length: 8 }, (_, i) => {
  const machine = pick(machines.filter(m => m && m.id && m.branchId));
  if (!machine) return null;
  
  const hoursAgo = (i + 1) * randInt(1, 4);

  return {
    id: `ge-${i + 1}`,
    reference: `GE-${new Date().getFullYear()}-${String(i + 1).padStart(4, '0')}`,

    // ── REF-06 §5.1 exact 4 fields ──
    machineId:    machine.id,
    truckPlate:   pick([...TRUCK_PLATES] as string[]),
    arrivingFrom: pick([...ARRIVING_FROM] as string[]),
    truckPhotoUrl: '/demo/truck-photo.jpg',

    // ── kept for list/table display + required by GateEntry type ──
    assetNumber:  machine.assetNumber,
    machineModel: `${machine.make} ${machine.model}`,
    branchId:     machine.branchId,
    branchName:   machine.branchName,
    direction:    pick(['IN', 'IN', 'IN', 'OUT'] as const),
    timestamp:    new Date(Date.now() - hoursAgo * 3600000).toISOString(),
    status:       pick(['Pending', 'Approved', 'Completed'] as const),
    driver:       pick(['Pat Cummins', 'Mitchell Starc', 'Trent Boult', 'Kagiso Rabada', 'Shaheen Afridi'] as string[]),
    destination:  `${pick(['DXB Yard', 'AUH Yard', 'TAW Yard', 'Workshop Bay', 'Offload Zone'] as string[])}`,
    gatePass:     `GP-${String(i + 1).padStart(3, '0')}`,
    createdAt:    NOW_ISO(),
    updatedAt:    NOW_ISO(),
  };
}).filter(Boolean) as GateEntry[];  // Remove null entries
