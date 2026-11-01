import { Breakdown } from '@/types/breakdown';
import { makeEntity } from './branches';
import { machines } from './machines';
import { technicians } from './workshop';
import { pick, randInt, daysAgoISO, NOW_ISO } from './_gen';

// REF-18 On-Site Breakdown Record — exact 10 fields + §9.2/9.3 operational additions

// Synthetic client names (§0 rule — no real client names)
const CLIENTS = [
  'Client A', 'Client B', 'Client C', 'Client D', 'Client E',
  'Client F', 'Client G', 'Client H', 'Client I', 'Client J',
];

// REF-18 BreakdownDetails — actual fault descriptions from the document
const BREAKDOWN_DETAILS = [
  'Charging Issues',
  'Battery is not charging',
  'Drive issues after elevation',
  'Charging and lift issues',
  'Boom will not extend beyond 60%',
  'Platform not leveling',
  'Engine cutting out under load',
  'No drive function',
  'Emergency stop stuck in pressed position',
  'Steering not responding',
  'Hydraulic oil leak detected',
  'Outrigger not deploying',
  'Machine will not start',
  'Limit switch fault on boom up',
  'Battery charger failure',
];

// REF-18 MachineNotes — root cause diagnosis
const MACHINE_NOTES = [
  'Charger',
  'Wiring Issues',
  'Limit Switch Issues',
  'No Fault Found',
  'Hydraulic valve fault',
  'Battery cell degradation',
  'Fuel system blockage',
  'Drive motor connector fault',
  'Control card failure',
  'Pump seal failure',
  'Solenoid valve stuck',
  'Sensor calibration required',
];

// REF-18 ActualWorkDone — corrective actions
const ACTUAL_WORK_DONE = [
  'Replaced battery charger and verified all machine functions.',
  'Repaired battery supply cable and verified machine functions.',
  'Checked pothole guard limit switch wiring, repaired damage, and tested all functions.',
  'Checked all functions and charging system; no fault found.',
  'Hydraulic valve replaced and system bled — operational.',
  'Replaced all four batteries and tested charging cycle.',
  'Fuel filter replaced and injectors cleaned — running normally.',
  'Drive motor connector repaired — fully operational.',
  'Control card replaced and all functions tested.',
  'Pump seal kit replaced and hydraulic system pressure tested.',
  'Solenoid valve cleaned and freed — all functions verified.',
  'Level sensor recalibrated and tested — resolved.',
];

// Fault attribution (§9.3)
const FAULT_ATTRIBUTIONS = [
  'JA Fault',
  'JA Fault',
  'JA Fault',
  'No fault found',
  'Customer-caused damage',
  'Operator error',
  'Warranty/OEM',
  'No access - client issue',
] as const;

function timeStr(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export const breakdowns: Breakdown[] = Array.from({ length: 4 }, (_, i) => {
  const machine = pick(machines.filter(m => m && m.id && m.branchId));
  if (!machine) return null;
  const tech = pick(technicians);
  const isResolved = randInt(0, 1) === 1;
  const reportedDaysAgo = randInt(0, 30);
  const reportedDate = daysAgoISO(reportedDaysAgo).split('T')[0];
  const reportedHour = randInt(7, 20);
  const reportedMinute = pick([0, 15, 30, 45]);
  const completionDate = isResolved ? daysAgoISO(randInt(0, reportedDaysAgo)).split('T')[0] : undefined;
  const completionHour = isResolved ? randInt(reportedHour, 22) : undefined;
  const completionMinute = isResolved ? pick([0, 15, 30, 45]) : undefined;

  return {
    ...makeEntity(`bd-${i + 1}`),
    reference: `BD-${new Date().getFullYear()}-${String(i + 1).padStart(4, '0')}`,

    // ── REF-18 exact 10 fields ──
    client:           pick(CLIENTS),                                          // Client
    eqptNo:           machine.assetNumber,                                    // EqptNo
    breakdownDetails: pick(BREAKDOWN_DETAILS),                                // BreakdownDetails
    bdReportedDate:   reportedDate,                                           // BD_ReportedDate
    bdReportedTime:   timeStr(reportedHour, reportedMinute),                  // BD_ReportedTime
    engineer:         isResolved ? tech.name : undefined,                     // Engineer
    completionDate:   completionDate,                                         // CompletionDate
    engineerCompletionTime: isResolved && completionHour !== undefined        // Engineer_CompletionTime
      ? timeStr(completionHour, completionMinute ?? 0)
      : undefined,
    machineNotes:     isResolved ? pick(MACHINE_NOTES) : undefined,           // MachineNotes
    actualWorkDone:   isResolved ? pick(ACTUAL_WORK_DONE) : undefined,        // ActualWorkDone

    // ── §9.2 / §9.3 operational additions ──
    machineId:        machine.id,
    assetNumber:      machine.assetNumber,
    machineModel:     `${machine.make} ${machine.model}`,
    branchId:         machine.branchId,
    branchName:       machine.branchName,
    location:         `${['Dubai', 'Abu Dhabi', 'Taweelah', 'Oilfields', 'Fujairah'][randInt(0, 4)]} - Site ${randInt(1, 20)}`,
    siteContactName:  pick(['Virat', 'Rohit', 'Steve', 'Kane', 'Joe', 'Ben'] as string[]),
    siteContactPhone: `+971 5${randInt(0, 9)} ${randInt(100, 999)} ${randInt(1000, 9999)}`,
    severity:         pick(['Critical', 'High', 'Medium', 'Low', 'Medium', 'High'] as const),
    status:           (isResolved ? pick(['Resolved', 'Closed'] as const) : pick(['Open', 'Assigned', 'In Progress'] as const)) as any,
    faultAttribution: pick(['JA Fault', 'JA Fault', 'JA Fault', 'No fault found', 'Customer-caused damage', 'Operator error', 'Warranty/OEM', 'No access - client issue'] as string[]),
    // Required by Breakdown type
    reportedBy:       pick(['Operator - Site', 'Customer Hotline', 'Driver'] as string[]),
    description:      pick(BREAKDOWN_DETAILS),
    hasDamageClaim:   randInt(0, 4) === 0,
    reportedAt:       `${reportedDate}T${timeStr(reportedHour, reportedMinute)}:00.000Z`,
    resolvedAt:       isResolved && completionDate
      ? `${completionDate}T${timeStr(completionHour ?? 12, completionMinute ?? 0)}:00.000Z`
      : undefined,
    technicianId:     isResolved ? tech.id : undefined,
    technicianName:   isResolved ? tech.name : undefined,
    timeline:         [],
    updatedAt:        NOW_ISO(),
  };
}).filter(Boolean) as Breakdown[];  // Remove null entries

export function getBreakdownById(id: string): Breakdown | undefined {
  return breakdowns.find((b) => b.id === id);
}
