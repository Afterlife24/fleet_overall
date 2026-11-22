// Loads the Hire Agreement <-> Planner <-> CRM demo data into a company.
// Johnson Arabia (org-ja) already ships with it. Any other company gets it once,
// the first time CRM, Planner or Quotation is active; it is never re-added after that
// (a persisted flag), except the demo machines, which live in memory like all
// demo machines and are re-created on each page load.
import { JA_ORG_ID } from '@/store/authStore';
import { useOrgStore } from '@/store/orgStore';
import { useCrmStore } from '@/store/crmStore';
import { useHireAgreementStore } from '@/store/hireAgreementStore';
import { useBookingStore } from '@/store/bookingStore';
import { useTaxInvoiceStore } from '@/store/taxInvoiceStore';
import { useCollectionStore } from '@/store/collectionStore';
import { useMqdStore } from '@/store/mqdStore';
import { useThirdPartyStore } from '@/store/thirdPartyStore';
import { useGateStore } from '@/store/gateStore';
import { linkNoteToGate, planGateSeeds } from '@/services/gateCore';
import { demoGateSeedsForOrg, gateSeedId } from '@/services/mock/demoGate';
import { machinesForOrg } from '@/services/mock/orgData';
import { counterKey, resolveReferences, type MachineLite, type RefSnapshot } from '@/services/collectionCore';
import { demoCollectionForOrg } from '@/services/mock/demoCollection';
import { signedFiles } from '@/services/signedFiles';
import {
  demoBookings, demoBookingsForOrg, demoInvoiceForQuotation, demoMachineId, demoMachinesForOrg, demoQuotationForAgreement, demoQuotationsForOrg, demoQuotationId, DEMO_AGREEMENT_QUOTATION,
} from '@/services/mock/demoHireLink';

const FLAG_KEY = 'fleet-hire-link-demo-v1';
const DEMO_APPS = ['crm', 'planner', 'quotation', 'gate'];

function seededOrgs(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(FLAG_KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function markSeeded(orgId: string): void {
  try {
    localStorage.setItem(FLAG_KEY, JSON.stringify([...new Set([...seededOrgs(), orgId])]));
  } catch {
    // storage full or unavailable: the demo is simply added again next time
  }
}

/** Idempotent. Safe to call from services and pages; never throws. */
export function ensureHireLinkDemo(orgId: string): void {
  seedHireLink(orgId);
  seedGateRecords(orgId); // after the machines, bookings and notes it needs
}

function seedHireLink(orgId: string): void {
  try {
    if (!orgId) return;
    if (orgId === JA_ORG_ID) {
      ensureCollectionDemo(orgId);
      return;
    }
    const done = seededOrgs().includes(orgId);
    if (!done) {
      const org = useOrgStore.getState();
      if (!DEMO_APPS.some((a) => org.isAppActive(orgId, a))) return;
    }

    // Machines (in memory): re-add the copies that are missing.
    const list = machinesForOrg(orgId);
    for (const m of demoMachinesForOrg(orgId)) {
      if (!list.some((x) => x.id === m.id)) list.push(m);
    }
    if (done) {
      ensureInvoiceDemo(orgId); // orgs seeded before the invoice demo existed
      ensureCollectionDemo(orgId);
      return;
    }

    // Quotations
    const crm = useCrmStore.getState();
    const haveQ = new Set(crm.quotations.map((q) => q.id));
    const newQ = demoQuotationsForOrg(orgId).filter((q) => !haveQ.has(q.id));
    if (newQ.length) useCrmStore.setState({ quotations: [...crm.quotations, ...newQ] });

    // Hire agreements: seed, then link seed rows created earlier without a quotation.
    const ha = useHireAgreementStore.getState();
    ha.ensureSeeded(orgId);
    for (const a of useHireAgreementStore.getState().forOrg(orgId)) {
      const q = demoQuotationForAgreement(a.id);
      if (q && !a.quotationId) useHireAgreementStore.getState().patch(a.id, { quotationId: q });
    }

    // Planner bookings
    const bs = useBookingStore.getState();
    const haveB = new Set(bs.userBookings.map((b) => b.id));
    const newB = demoBookingsForOrg(orgId).filter((b) => !haveB.has(b.id));
    if (newB.length) useBookingStore.setState({ userBookings: [...bs.userBookings, ...newB] });

    markSeeded(orgId);
    ensureInvoiceDemo(orgId);
    ensureCollectionDemo(orgId);
  } catch (err) {
    console.error('[demoSeed]', err);
  }
}
/**
 * Inserts the sample linked invoice (QT-2026-0010/01) once per org and sets the quotation
 * counter to at least 1. Skips when the quotation is missing in the CRM store. A deleted
 * sample is not re-added (guarded by demoLinkedOrgs). Never throws.
 */
export function ensureInvoiceDemo(orgId: string): void {
  try {
    if (!orgId) return;
    const store = useTaxInvoiceStore.getState();
    if (store.demoLinkedOrgs.includes(orgId)) return;
    const qid = demoQuotationId(orgId, DEMO_AGREEMENT_QUOTATION[5]);
    if (!useCrmStore.getState().quotations.some((q) => q.id === qid)) return;
    const draft = demoInvoiceForQuotation(orgId);
    if (!draft) return;
    store.ensureSeeded(orgId);
    const now = new Date().toISOString();
    const id = `inv-demo-${orgId}-1`;
    useTaxInvoiceStore.setState((s) => ({
      invoices: s.invoices.some((i) => i.id === id)
        ? s.invoices
        : [...s.invoices, { ...draft, id, createdAt: now, updatedAt: now }],
      demoLinkedOrgs: [...s.demoLinkedOrgs, orgId],
      sequenceByQuotation: { ...s.sequenceByQuotation, [qid]: Math.max(s.sequenceByQuotation[qid] ?? 0, 1) },
    }));
  } catch (err) {
    console.error('[demoSeed]', err);
  }
}
/** Hand-built one-page PDF (no library) used as the placeholder signed copy of CN-2026-0002. */
function placeholderPdfBytes(): Uint8Array {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '', // content stream, filled below
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream = 'BT /F1 14 Tf 20 70 Td (Signed copy - demo placeholder) Tj ET';
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}

const COLLECTION_DEMO_YEAR = 2026;

/**
 * Inserts the demo Collection Note, MQD and Third-Party Services documents once per org.
 * Skips documents whose machine is missing, inserts only absent ids, raises the counters to at
 * least the seeded sequence, and stores a placeholder signed PDF for CN-2026-0002. Never throws.
 */
export function ensureCollectionDemo(orgId: string): void {
  try {
    if (!orgId) return;
    const cs = useCollectionStore.getState();
    const ms = useMqdStore.getState();
    const ts = useThirdPartyStore.getState();
    if (cs.demoSeededOrgs.includes(orgId) && ms.demoSeededOrgs.includes(orgId) && ts.demoSeededOrgs.includes(orgId)) return;

    useHireAgreementStore.getState().ensureSeeded(orgId);
    useTaxInvoiceStore.getState().ensureSeeded(orgId);
    if (orgId === JA_ORG_ID) {
      ensureInvoiceDemo(orgId);
    }
    // The org-ja demo bookings may be absent from the booking store (e.g. a persisted state from
    // before the demo). Use them for resolving the demo references only; the store is not changed.
    const storeBookings = useBookingStore.getState().userBookings;
    const haveB = new Set(storeBookings.map((b) => b.id));
    const refBookings = orgId === JA_ORG_ID
      ? [...storeBookings, ...demoBookings.filter((b) => !haveB.has(b.id))]
      : storeBookings;

    const raw = machinesForOrg(orgId);
    const machines: MachineLite[] = raw.map((m) => ({
      orgId, id: m.id, fleetNo: m.fleetNo, assetNumber: m.assetNumber,
      make: m.make, model: m.model, serialNumber: m.serialNumber,
    }));
    const snap: RefSnapshot = {
      orgId,
      bookings: refBookings,
      agreements: useHireAgreementStore.getState().agreements,
      quotations: useCrmStore.getState().quotations,
      invoices: useTaxInvoiceStore.getState().invoices,
    } as RefSnapshot;
    const set = demoCollectionForOrg(orgId, {
      machines,
      refsFor: (machineId) => {
        const lite = machines.find((m) => m.id === machineId) as MachineLite;
        const full = raw.find((m) => m.id === machineId);
        return resolveReferences(lite, full?.currentCustomer, snap);
      },
    });

    // Placeholder signed copy for the signed demo note.
    const bytes = placeholderPdfBytes();
    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
    const notes = set.notes.map((n) =>
      n.signedFile ? { ...n, signedFile: { ...n.signedFile, size: blob.size } } : n,
    );

    const haveN = new Set(cs.notes.map((n) => n.id));
    const newN = notes.filter((n) => !haveN.has(n.id));
    const haveM = new Set(ms.records.map((r) => r.id));
    const newM = set.mqds.filter((r) => !haveM.has(r.id));
    const haveT = new Set(ts.documents.map((d) => d.id));
    const newT = set.tps.filter((d) => !haveT.has(d.id));

    const seqOf = (nums: string[]) =>
      nums.reduce((mx, n) => Math.max(mx, Number(/-(\d+)$/.exec(n)?.[1] ?? 0)), 0);
    const raise = (counters: Record<string, number>, type: 'CN' | 'MQD' | 'TPS', nums: string[]) => {
      const key = counterKey(orgId, type, COLLECTION_DEMO_YEAR);
      return { ...counters, [key]: Math.max(counters[key] ?? 0, seqOf(nums)) };
    };

    useCollectionStore.setState((s) => ({
      notes: [...s.notes, ...newN.filter((n) => !s.notes.some((x) => x.id === n.id))],
      counters: raise(s.counters, 'CN', notes.map((n) => n.number)),
      demoSeededOrgs: [...new Set([...s.demoSeededOrgs, orgId])],
    }));
    useMqdStore.setState((s) => ({
      records: [...s.records, ...newM.filter((r) => !s.records.some((x) => x.id === r.id))],
      counters: raise(s.counters, 'MQD', set.mqds.map((r) => r.number)),
      demoSeededOrgs: [...new Set([...s.demoSeededOrgs, orgId])],
    }));
    useThirdPartyStore.setState((s) => ({
      documents: [...s.documents, ...newT.filter((d) => !s.documents.some((x) => x.id === d.id))],
      counters: raise(s.counters, 'TPS', set.tps.map((d) => d.number)),
      demoSeededOrgs: [...new Set([...s.demoSeededOrgs, orgId])],
    }));

    for (const n of newN) {
      if (!n.signedFile) continue;
      signedFiles
        .put(n.signedFile.key, blob, { name: n.signedFile.name, mime: n.signedFile.mime })
        .catch((err) => console.error('[demoSeed]', err));
    }
  } catch (err) {
    console.error('[demoSeed]', err);
  }
}
const GATE_BOOKING_MACHINE_N = 5;

/** Inserts the unmarked demo gate records of a company that have their machine. Never throws. */
function seedGateRecords(orgId: string): void {
  try {
    if (!orgId) return;
    const raw = machinesForOrg(orgId);
    const machines: MachineLite[] = raw.map((m) => ({
      orgId, id: m.id, fleetNo: m.fleetNo, assetNumber: m.assetNumber,
      make: m.make, model: m.model, serialNumber: m.serialNumber,
    }));
    const machineId = demoMachineId(orgId, GATE_BOOKING_MACHINE_N);
    const bk = useBookingStore.getState().userBookings.find((b) => b.orgId === orgId && b.machineId === machineId && b.id.includes('bk-demo-'))
      ?? demoBookingsForOrg(orgId).find((b) => b.machineId === machineId);
    const booking = bk
      ? { id: bk.id, startDate: bk.startDate, customerName: bk.customerName, deliveryAddress: bk.deliveryAddress }
      : undefined;

    const gs = useGateStore.getState();
    const seeds = demoGateSeedsForOrg(orgId, { machines, booking });
    const plan = planGateSeeds(
      gs.seedMarkers[orgId] ?? [],
      new Set(gs.entries.map((r) => r.id)),
      seeds,
    );
    if (plan.length === 0) return;
    // A seed skipped for a missing machine is absent from `seeds`, so it gets no marker.
    const fresh = gs.seedOrg(orgId, plan);

    const row2 = fresh.find((r) => r.id === gateSeedId(orgId, 2));
    if (row2) {
      const cs = useCollectionStore.getState();
      const note = cs.notes.find((n) => n.id === `cn-demo-${orgId}-2`)
        ?? cs.notes.find((n) => n.orgId === orgId && n.number === 'CN-2026-0002');
      if (note && !note.collectedByGateId && !note.collectedByGateRef && !note.collectedAt) {
        cs.patch(note.id, linkNoteToGate(note, row2));
      }
    }
  } catch (err) {
    console.error('[demoSeed]', err);
  }
}

/** Idempotent. Creates the demo gate records of a company once. Never throws. */
export function ensureGateDemo(orgId: string): void {
  try {
    if (!orgId) return;
    ensureHireLinkDemo(orgId); // machines, bookings and notes; also seeds the gate records
    seedGateRecords(orgId);
  } catch (err) {
    console.error('[demoSeed]', err);
  }
}