import { WorkshopJob, WorkshopStatus, Priority, Technician, WorkshopBay } from '@/types/workshop';
import { branches, makeEntity } from './branches';
import { machines } from './machines';
import { pick, randInt, randFloat, daysAgoISO, daysAheadISO, NOW_ISO, randId, randName } from './_gen';
import { TimelineEvent } from '@/types/common';

const COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

export const technicians: Technician[] = Array.from({ length: 8 }, (_, i) => {
  const branch = pick(branches);
  return {
    id: `tech-${i + 1}`,
    name: randName(),
    role: pick(['Senior Technician', 'Technician', 'Junior Technician', 'Workshop Lead', 'Electrician']),
    branchId: branch.id,
    branchName: branch.name,
    specialization: pick(['Hydraulics', 'Electrical', 'Diesel Engines', 'Boom Systems', 'Scissor Lifts', 'General']),
    status: pick(['Available', 'Assigned', 'On Leave']),
    avatarColor: COLORS[i % COLORS.length],
    activeJobs: randInt(0, 4),
    completedJobs: randInt(20, 400),
    rating: randFloat(3.8, 5, 1),
  };
});

export const workshopBays: WorkshopBay[] = branches.flatMap((branch, bi) =>
  Array.from({ length: 3 }, (_, i) => {
    const occupied = randInt(0, 1) === 1;
    return {
      id: `bay-${branch.id}-${i + 1}`,
      name: `${branch.code} Bay ${String.fromCharCode(65 + i)}${randInt(1, 3)}`,
      branchId: branch.id,
      status: occupied ? 'Occupied' : pick(['Available', 'Maintenance']) as 'Available' | 'Maintenance' | 'Occupied',
    };
  })
);

const STATUSES: WorkshopStatus[] = [
  'Waiting Parts', 'Waiting Mechanic', 'Under Repair', 'Work In Progress', 'PDI', 'Quality Check', 'Available',
];

const PRIORITIES: Priority[] = ['Low', 'Medium', 'High', 'Critical'];

const PARTS = [
  'Hydraulic Seal Kit', 'Boom Control Valve', 'Battery 12V 200Ah', 'Tire 23x10.5-12',
  'Engine Oil Filter', 'Platform Level Sensor', 'Drive Motor Brush Set',
  'Emergency Stop Button', 'Proportional Valve', 'Tilt Sensor Assembly',
];

function genJobTimeline(status: WorkshopStatus): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const count = randInt(3, 6);
  for (let i = 0; i < count; i++) {
    events.push({
      id: `wtl-${randId()}`,
      timestamp: daysAgoISO(i * randInt(1, 5)),
      title: pick([
        'Job card created',
        'Machine brought to workshop',
        'Diagnosis completed',
        'Parts ordered from supplier',
        'Technician assigned',
        'Repair in progress',
        'Quality check initiated',
      ]),
      description: pick(['No issues', 'Awaiting parts delivery', 'ETA 2 days', '']),
      actor: pick(['System', 'Ravindra Jadeja', 'Workshop Manager']),
      type: pick(['info', 'success', 'warning', 'maintenance']),
    });
  }
  return events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

export const workshopJobs: WorkshopJob[] = Array.from({ length: 20 }, (_, i) => {
  const machine = pick(machines.filter(m => m && m.id && m.branchId)); // Filter out any invalid machines
  if (!machine) {
    console.warn(`Workshop job ${i}: no valid machine found`);
    return null;
  }
  
  const branch = branches.find((b) => b.id === machine.branchId);
  if (!branch) {
    console.warn(`Workshop job ${i}: no branch found for machine ${machine.id}`);
    return null;
  }
  
  const status = pick(STATUSES);
  const tech = randInt(0, 1) ? pick(technicians) : undefined;
  const bay = randInt(0, 1) ? pick(workshopBays.filter((wb) => wb.branchId === branch.id)) : undefined;
  const partsCount = randInt(0, 4);
  const parts: string[] = [];
  const pool = [...PARTS];
  for (let p = 0; p < partsCount; p++) {
    parts.push(pick(pool));
  }
  const isComplete = status === 'Available' || status === 'Quality Check';

  return {
    ...makeEntity(`wj-${i + 1}`),
    reference: `WS-${2025}-${String(i + 1).padStart(4, '0')}`,
    machineId: machine.id,
    assetNumber: machine.assetNumber,
    machineModel: `${machine.make} ${machine.model}`,
    branchId: branch.id,
    branchName: branch.name,
    status,
    priority: pick(PRIORITIES),
    technicianId: tech?.id,
    technicianName: tech?.name,
    bayId: bay?.id,
    bayName: bay?.name,
    description: pick([
      'Hydraulic system leak repair',
      'Boom extension malfunction',
      'Engine overhaul and service',
      'Electrical system diagnostic',
      'Platform level calibration',
      'Drive motor replacement',
      'Annual mandatory service',
      'Post-rental PDI inspection',
    ]),
    estimatedHours: randFloat(2, 40, 1),
    actualHours: isComplete ? randFloat(2, 48, 1) : undefined,
    partsRequired: parts,
    scheduledDate: daysAgoISO(randInt(0, 15)),
    completedDate: isComplete ? daysAgoISO(randInt(0, 5)) : undefined,
    timeline: genJobTimeline(status),
    updatedAt: NOW_ISO(),
  };
}).filter(Boolean) as WorkshopJob[];  // Remove any null entries

export function getWorkshopJobById(id: string): WorkshopJob | undefined {
  return workshopJobs.find((j) => j.id === id);
}

export function getTechnicianById(id: string): Technician | undefined {
  return technicians.find((t) => t.id === id);
}
