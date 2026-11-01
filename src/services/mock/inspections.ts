import { Inspection, InspectionType, InspectionStatus, ChecklistItem, InspectionSection } from '@/types/inspection';
import { branches, makeEntity } from './branches';
import { machines } from './machines';
import { technicians } from './workshop';
import { pick, pickMany, randInt, daysAgoISO, daysAheadISO, NOW_ISO, randId } from './_gen';
import { TimelineEvent } from '@/types/common';

export const inspectionSections: Record<InspectionType, InspectionSection[]> = {
  PHI: [
    { name: 'Structural', items: ['Boom condition - no cracks or deformations', 'Platform integrity - rails and gate functional', 'Chassis frame - no damage', 'Outriggers - deploy and retract smoothly'] },
    { name: 'Hydraulics', items: ['Hydraulic oil level correct', 'No visible leaks from cylinders', 'Hose condition - no chafing or cracks', 'Boom lift/lower function normal', 'Platform rotate function normal'] },
    { name: 'Electrical', items: ['Battery charge above 80%', 'All lights operational', 'Emergency stop functional', 'Horn operational', 'Control panel display readable'] },
    { name: 'Safety Systems', items: ['Load sensor calibrated', 'Tilt alarm functional', 'Descend alarm functional', 'Overload protection tested', 'Pothole protection system operational'] },
    { name: 'Operational', items: ['Drive function - forward/reverse', 'Steering responsive', 'Braking effective', 'Speed control proportional', 'All labels and decals present'] },
  ],
  PDI: [
    { name: 'Pre-Delivery', items: ['Engine oil level checked', 'Coolant level adequate', 'Hydraulic fluid topped up', 'Fuel tank full', 'Tire pressure and condition verified'] },
    { name: 'Function Tests', items: ['All boom functions smooth', 'Platform controls responsive', 'Ground controls operational', 'Emergency lowering tested', 'Outrigger deployment tested'] },
    { name: 'Regulatory', items: ['Registration documents present', 'Insurance valid', 'Operator license verified', 'Safety certificate current', 'Load chart present and legible'] },
    { name: 'Cosmetic', items: ['Machine clean and presentable', 'No fluid spills', 'All guards in place', 'Warning decals present', 'Paint condition acceptable'] },
  ],
  Mandatory: [
    { name: 'Engine & Drivetrain', items: ['Engine starts without issue', 'No abnormal noise from drivetrain', 'Transmission shifts smoothly', 'Exhaust emissions within limits', 'Belts and hoses inspected'] },
    { name: 'Braking & Steering', items: ['Service brake effective', 'Parking brake holds on grade', 'Steering free of excessive play', 'No hydraulic steering leaks', 'Wheel bearings inspected'] },
    { name: 'Lifting Systems', items: ['Boom wear pads inspected', 'Lift cylinder internal leak check', 'Load holding valves tested', 'Chain/cable condition inspected', 'Slew mechanism operational'] },
    { name: 'Safety Devices', items: ['Rated capacity indicator tested', 'Anti-two-block device functional', 'Boom angle indicator accurate', 'Load moment indicator calibrated', 'Emergency stop verified'] },
  ],
  MQD: [
    { name: 'Maintenance Quality', items: ['All grease points serviced', 'Filters replaced per schedule', 'Oil samples taken for analysis', 'Bolt torque values verified', 'Welds inspected for cracking'] },
    { name: 'Documentation', items: ['Service records up to date', 'Parts used logged correctly', 'Technician sign-off complete', 'Next service interval set', 'Quality photographs attached'] },
  ],
};

function genChecklist(type: InspectionType): ChecklistItem[] {
  const sections = inspectionSections[type];
  const items: ChecklistItem[] = [];
  for (const section of sections) {
    for (const question of section.items) {
      const result = pick(['Pass', 'Pass', 'Pass', 'Fail', 'N/A', 'Pending']) as ChecklistItem['result'];
      items.push({
        id: `chk-${randId()}`,
        section: section.name,
        question,
        result,
        notes: result === 'Fail' ? pick(['Requires immediate attention', 'Part replacement needed', 'Calibration required', 'Leak detected']) : undefined,
        critical: randInt(0, 1) === 1,
      });
    }
  }
  return items;
}

function genTimeline(status: InspectionStatus): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const count = randInt(3, 5);
  for (let i = 0; i < count; i++) {
    events.push({
      id: `itl-${randId()}`,
      timestamp: daysAgoISO(i * randInt(1, 4)),
      title: pick([
        'Inspection scheduled',
        'Inspector assigned',
        'Inspection started',
        'Section 1 completed',
        'Defect identified - hydraulic leak',
        'Inspection submitted for approval',
        'Approved and signed off',
      ]),
      actor: pick(['System', 'Inspector', 'Workshop Manager', 'Branch Manager']),
      type: pick(['info', 'success', 'warning', 'maintenance']),
    });
  }
  return events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

const STATUS_BY_TYPE: Record<InspectionType, InspectionStatus[]> = {
  PHI: ['Pending', 'In Progress', 'Passed', 'Failed', 'Awaiting Approval'],
  PDI: ['Pending', 'In Progress', 'Passed', 'Failed', 'Awaiting Approval'],
  Mandatory: ['Pending', 'In Progress', 'Passed', 'Failed', 'Awaiting Approval'],
  MQD: ['Pending', 'In Progress', 'Passed', 'Failed', 'Awaiting Approval'],
};

export function createInspections(type: InspectionType, count: number): Inspection[] {
  return Array.from({ length: count }, (_, i) => {
    const machine = pick(machines.filter(m => m && m.id && m.branchId));
    if (!machine) {
      console.warn(`Inspection ${type} ${i}: no valid machine found`);
      return null;
    }
    
    const branch = branches.find((b) => b.id === machine.branchId);
    if (!branch) {
      console.warn(`Inspection ${type} ${i}: no branch found for machine ${machine.id}`);
      return null;
    }
    
    const inspector = pick(technicians);
    const status = pick(STATUS_BY_TYPE[type]);
    const isComplete = status === 'Passed' || status === 'Failed';

    return {
      ...makeEntity(`insp-${type.toLowerCase()}-${i + 1}`),
      reference: `${type}-${2025}-${String(i + 1).padStart(4, '0')}`,
      type,
      machineId: machine.id,
      assetNumber: machine.assetNumber,
      machineModel: `${machine.make} ${machine.model}`,
      branchId: branch.id,
      branchName: branch.name,
      inspectorId: inspector.id,
      inspectorName: inspector.name,
      status,
      scheduledDate: daysAgoISO(randInt(0, 20)),
      completedDate: isComplete ? daysAgoISO(randInt(0, 5)) : undefined,
      overallResult: isComplete ? (status === 'Passed' ? 'Pass' : 'Fail') : undefined,
      checklist: genChecklist(type),
      photoCount: randInt(0, 24),
      notes: pick(['Routine inspection', 'Customer-reported issue', 'Post-repair verification', '']),
      timeline: genTimeline(status),
    };
  }).filter(Boolean) as Inspection[];  // Remove null entries
}

export const inspections: Inspection[] = [
  ...createInspections('PHI', 12),
  ...createInspections('PDI', 10),
  ...createInspections('Mandatory', 8),
  ...createInspections('MQD', 6),
];

export function getInspectionById(id: string): Inspection | undefined {
  return inspections.find((i) => i.id === id);
}

export function getInspectionsByType(type: InspectionType): Inspection[] {
  return inspections.filter((i) => i.type === type);
}
