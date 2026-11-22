// Demo gate records for a company. Pure builder: no store access, no clock, no randomness.
// Row 1: J105 Gate-Out (delivery, Completed). Row 2: J104 Gate-In by QR (Completed).
// Row 3: J101 Gate-Out (Pending). Machine statuses and Collection Notes are never changed here.
import type { GateRecord } from '@/types/gate';
import { buildQrPayload, type MachineLite } from '@/services/collectionCore';
import { buildGateRecordFields } from '@/services/gateCore';
import { demoMachineId } from './demoHireLink';

export interface DemoGateBooking {
  id: string;
  /** YYYY-MM-DD hire start date. */
  startDate?: string;
  customerName?: string;
  deliveryAddress?: string;
}

export interface DemoGateCtx {
  machines: MachineLite[];
  /** The company's copy of booking bk-demo-5, when present. */
  booking?: DemoGateBooking;
}

export const GATE_DEMO_TIME_ZONE = 'Asia/Dubai';
export const GATE_DEMO_IN_INSTANT = '2026-11-28T10:20:00.000Z';
export const GATE_DEMO_PENDING_INSTANT = '2026-12-01T05:00:00.000Z';
/** Gate-Out delivery: 09:15 Asia/Dubai (UTC+4), two days before the booking starts. */
const OUT_DAYS_BEFORE_START = 2;
const OUT_TIME_UTC = 'T05:15:00.000Z';

export const gateSeedId = (orgId: string, n: number) => `ge-demo-${orgId}-${n}`;
const gateSeedRef = (n: number) => `GP-DEMO-${n}`;

function deliveryInstant(startDate: string | undefined): string | undefined {
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return undefined;
  const start = new Date(`${startDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) return undefined;
  const day = new Date(start.getTime() - OUT_DAYS_BEFORE_START * 86400000).toISOString().slice(0, 10);
  return `${day}${OUT_TIME_UTC}`;
}

export function demoGateSeedsForOrg(orgId: string, ctx: DemoGateCtx): GateRecord[] {
  const out: GateRecord[] = [];
  const find = (n: number) => ctx.machines.find((m) => m.id === demoMachineId(orgId, n));

  const common = (n: number, m: MachineLite, f: ReturnType<typeof buildGateRecordFields>) => ({
    id: gateSeedId(orgId, n),
    seedKey: gateSeedId(orgId, n),
    orgId,
    reference: gateSeedRef(n),
    gatePass: gateSeedRef(n),
    machineId: m.id,
    assetNumber: m.assetNumber,
    machineModel: `${m.make ?? ''} ${m.model ?? ''}`.trim(),
    branchId: 'br-dxb',
    branchName: 'Dubai',
    createdAt: f.timestamp,
    updatedAt: f.timestamp,
    ...f,
  });

  // 1: J105 Gate-Out, delivery to MNO Company LLC.
  const m5 = find(5);
  const ts1 = deliveryInstant(ctx.booking?.startDate);
  if (m5 && ts1 && ctx.booking) {
    const f = buildGateRecordFields(ts1, GATE_DEMO_TIME_ZONE, m5, 'Manual', 'server');
    const customer = ctx.booking.customerName || 'MNO Company LLC';
    out.push({
      ...common(1, m5, f),
      direction: 'OUT',
      status: 'Completed',
      driver: 'Imran Qureshi',
      customer,
      destination: ctx.booking.deliveryAddress || 'Customer site',
      truckPlate: 'DXB 33333',
      arrivingFrom: 'Yard',
      notes: `Delivery to ${customer} under booking ${ctx.booking.id}`,
    });
  }

  // 2: J104 Gate-In by QR scan, on the date of CN-2026-0002.
  const m4 = find(4);
  if (m4) {
    const f = buildGateRecordFields(GATE_DEMO_IN_INSTANT, GATE_DEMO_TIME_ZONE, m4, 'QR', 'server', buildQrPayload(m4));
    out.push({
      ...common(2, m4, f),
      direction: 'IN',
      status: 'Completed',
      driver: 'Saleem Akhtar',
      destination: 'Yard',
      truckPlate: 'SHJ 98765',
      arrivingFrom: 'Dubai',
      notes: 'Off-hire return collected under CN-2026-0002',
    });
  }

  // 3: J101 Gate-Out, waiting for approval.
  const m1 = find(1);
  if (m1) {
    const f = buildGateRecordFields(GATE_DEMO_PENDING_INSTANT, GATE_DEMO_TIME_ZONE, m1, 'Manual', 'server');
    out.push({
      ...common(3, m1, f),
      direction: 'OUT',
      status: 'Pending',
      driver: 'Bilal Hussain',
      destination: 'Dubai Marina - Site 12',
      truckPlate: 'DXB 44444',
      arrivingFrom: 'Yard',
      notes: 'Delivery pending approval',
    });
  }

  return out;
}
