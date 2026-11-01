import { JobCard, JobCardStatus, JobCardItem } from '@/types/jobcard';
import { branches, makeEntity } from './branches';
import { machines } from './machines';
import { technicians } from './workshop';
import { pick, randInt, randFloat, daysAgoISO, NOW_ISO, randId } from './_gen';
import { TimelineEvent } from '@/types/common';

const STATUSES: JobCardStatus[] = ['Open', 'Assigned', 'In Progress', 'On Hold', 'Completed', 'Closed'];

const PARTS_CATALOG = [
  { description: 'Hydraulic Oil Filter', unitCost: 45 },
  { description: 'Boom Wear Pad Set', unitCost: 180 },
  { description: 'Battery 12V 200Ah', unitCost: 850 },
  { description: 'Control Valve Assembly', unitCost: 1200 },
  { description: 'Tire 23x10.5-12', unitCost: 220 },
  { description: 'Proportional Joystick', unitCost: 340 },
  { description: 'Platform Level Sensor', unitCost: 165 },
  { description: 'Emergency Stop Assembly', unitCost: 95 },
  { description: 'Hydraulic Seal Kit', unitCost: 75 },
  { description: 'Drive Motor Brush Set', unitCost: 130 },
];

function genItems(): JobCardItem[] {
  const count = randInt(1, 5);
  const items: JobCardItem[] = [];
  for (let i = 0; i < count; i++) {
    const part = pick(PARTS_CATALOG);
    const qty = randInt(1, 4);
    items.push({
      id: `jci-${randId()}`,
      description: part.description,
      quantity: qty,
      unitCost: part.unitCost,
      total: qty * part.unitCost,
    });
  }
  return items;
}

function genTimeline(status: JobCardStatus): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const count = randInt(3, 6);
  for (let i = 0; i < count; i++) {
    events.push({
      id: `jctl-${randId()}`,
      timestamp: daysAgoISO(i * randInt(1, 5)),
      title: pick([
        'Job card opened',
        'Technician assigned',
        'Diagnosis logged',
        'Parts requisition created',
        'Labor hours recorded',
        'Quality check passed',
        'Job card closed',
      ]),
      actor: pick(['System', 'Workshop Manager', 'Technician']),
      type: pick(['info', 'success', 'maintenance']),
    });
  }
  return events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

export const jobCards: JobCard[] = Array.from({ length: 10 }, (_, i) => {
  const machine = pick(machines.filter(m => m && m.id && m.branchId));
  if (!machine) return null;
  
  const branch = branches.find((b) => b.id === machine.branchId);
  if (!branch) return null;
  
  const tech = pick(technicians);
  const status = pick(STATUSES);
  const items = genItems();
  const partsTotal = items.reduce((sum, it) => sum + it.total, 0);
  const laborHours = randFloat(1, 40, 1);
  const laborCost = laborHours * randFloat(35, 65, 0);
  const isClosed = status === 'Closed' || status === 'Completed';

  return {
    ...makeEntity(`jc-${i + 1}`),
    reference: `JC-${2025}-${String(i + 1).padStart(4, '0')}`,
    machineId: machine.id,
    assetNumber: machine.assetNumber,
    machineModel: `${machine.make} ${machine.model}`,
    branchId: branch.id,
    branchName: branch.name,
    status,
    technicianId: tech.id,
    technicianName: tech.name,
    openedAt: daysAgoISO(randInt(0, 20)),
    closedAt: isClosed ? daysAgoISO(randInt(0, 5)) : undefined,
    laborHours,
    laborCost,
    items,
    totalCost: partsTotal + laborCost,
    description: pick([
      'Routine maintenance and service',
      'Hydraulic system repair',
      'Electrical fault diagnosis',
      'Boom function restoration',
      'Post-rental refurbishment',
      'Mandatory annual service',
    ]),
    timeline: genTimeline(status),
  };
}).filter(Boolean) as JobCard[];  // Remove null entries

export function getJobCardById(id: string): JobCard | undefined {
  return jobCards.find((j) => j.id === id);
}
