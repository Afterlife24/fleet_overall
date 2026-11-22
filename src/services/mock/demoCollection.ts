// Demo Collection Note / MQD / Third-Party Services records. Pure builders: no store access.
// Reference fields come from the caller (resolveReferences in the facade/seeder), never hand-typed.
import type { CollectionNote, MqdRecord, ReferenceFields, ServiceLine, TpsDocument } from '@/types/collection';
import type { MachineLite } from '@/services/collectionCore';
import { demoMachineId } from './demoHireLink';

export interface DemoCollectionCtx {
  machines: MachineLite[];
  refsFor(machineId: string): ReferenceFields;
}

export interface DemoCollectionSet {
  notes: CollectionNote[];
  mqds: MqdRecord[];
  tps: TpsDocument[];
}

const STAMP = '2026-12-01T09:00:00.000Z';

const cnId = (orgId: string, n: 1 | 2) => `cn-demo-${orgId}-${n}`;
const mqdId = (orgId: string, n: 1 | 2) => `mqd-demo-${orgId}-${n}`;
const tpsId = (orgId: string, n: 1 | 2) => `tps-demo-${orgId}-${n}`;

function link(orgId: string, n: 1 | 2) {
  return { cnId: cnId(orgId, n), mqdId: mqdId(orgId, n), tpsId: tpsId(orgId, n) };
}

function line(orgId: string, i: number, l: Omit<ServiceLine, 'id' | 'reference'>): ServiceLine {
  return { id: `tpsl-demo-${orgId}-${i}`, reference: '', ...l };
}

export function demoCollectionForOrg(orgId: string, ctx: DemoCollectionCtx): DemoCollectionSet {
  const out: DemoCollectionSet = { notes: [], mqds: [], tps: [] };
  const has = (id: string) => ctx.machines.some((m) => m.id === id);

  // CN-2026-0001 / MQD-2026-0001 / TPS-2026-0001: J105, Scheduled, signed Pending.
  const m5 = demoMachineId(orgId, 5);
  if (has(m5)) {
    const refs = ctx.refsFor(m5);
    const base = { ...refs, orgId, ...link(orgId, 1), signedStatus: 'Pending' as const, createdAt: STAMP, updatedAt: STAMP };
    out.notes.push({
      ...base, id: cnId(orgId, 1), number: 'CN-2026-0001', status: 'Scheduled', date: '2026-12-14',
      collectionAddress: refs.site, driver: '', vehicle: '', remarks: '',
    });
    out.mqds.push({
      ...base, id: mqdId(orgId, 1), number: 'MQD-2026-0001', date: '2026-12-14',
      hirer: refs.customerName,
      fields: {
        offHireNotes: refs.refNotes.join('\n'),
        offHireJA: 'Virat Kohli',
        offHireHirer: 'MNO site manager',
        offHireDate: '2026-12-14',
      },
      photoKeys: [],
    });
    out.tps.push({
      ...base, id: tpsId(orgId, 1), number: 'TPS-2026-0001',
      lines: [
        line(orgId, 1, { provider: 'Gulf Haulage LLC', serviceType: 'Transport', description: 'Low-bed transport', date: '2026-12-14', quantity: 1, rate: 1200 }),
        line(orgId, 2, { provider: 'Al Rafi Cranes', serviceType: 'Crane', description: '50T crane lift', date: '2026-12-14', quantity: 1, rate: 2500 }),
      ],
      notes: '', approvedBy: 'Steve Smith', signature: '',
    });
  }

  // CN-2026-0002 / MQD-2026-0002 / TPS-2026-0002: J104, Collected, signed Signed.
  const m4 = demoMachineId(orgId, 4);
  if (has(m4)) {
    const refs = ctx.refsFor(m4);
    const base = {
      ...refs, orgId, ...link(orgId, 2), signedStatus: 'Signed' as const, createdAt: STAMP, updatedAt: STAMP,
    };
    out.notes.push({
      ...base, id: cnId(orgId, 2), number: 'CN-2026-0002', status: 'Collected', date: '2026-11-28',
      collectionAddress: refs.site, driver: '', vehicle: '', remarks: '',
      signedFile: {
        key: `${orgId}/CN/cn-demo-${orgId}-2`, name: 'CN-2026-0002-signed.pdf',
        mime: 'application/pdf', size: 0, uploadedAt: STAMP,
      },
    });
    out.mqds.push({
      ...base, id: mqdId(orgId, 2), number: 'MQD-2026-0002', date: '2026-11-28',
      hirer: refs.customerName, fields: { offHireNotes: refs.refNotes.join('\n') }, photoKeys: [],
    });
    out.tps.push({
      ...base, id: tpsId(orgId, 2), number: 'TPS-2026-0002', lines: [], notes: '', approvedBy: '', signature: '',
    });
  }

  return out;
}
