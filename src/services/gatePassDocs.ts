// Gate pass document facade: resolves linked document numbers and the company name, then prints.
// Must not import gateStore, services.ts or appStore.ts.
import { useCrmStore } from '@/store/crmStore';
import { useHireAgreementStore } from '@/store/hireAgreementStore';
import { useBookingStore } from '@/store/bookingStore';
import { useTaxInvoiceStore } from '@/store/taxInvoiceStore';
import { useCollectionStore } from '@/store/collectionStore';
import { useOrgStore } from '@/store/orgStore';
import { useAuthStore } from '@/store/authStore';
import { machinesForOrg } from '@/services/mock/orgData';
import { resolveReferences, type MachineLite, type RefSnapshot } from '@/services/collectionCore';
import { downloadBlob, qrDataUrl } from '@/services/collectionPdf';
import { buildGatePayload, pngFileName } from '@/services/gatePassCore';
import { gatePassPdf, type GatePassPdfCtx } from '@/services/gatePassPdf';
import type { GateRecord } from '@/types/gate';

function snapshot(orgId: string): RefSnapshot {
  return {
    orgId,
    bookings: useBookingStore.getState().userBookings,
    agreements: useHireAgreementStore.getState().agreements,
    quotations: useCrmStore.getState().quotations,
    invoices: useTaxInvoiceStore.getState().invoices,
  } as RefSnapshot;
}

function companyName(orgId: string): string {
  const user = useAuthStore.getState().user;
  if (user && user.orgId === orgId && user.orgName) return user.orgName;
  return useOrgStore.getState().getOrg(orgId)?.name ?? orgId;
}

/** Linked quotation, agreement and collection note numbers plus the company name. Never throws. */
export function gatePassContext(orgId: string, r: GateRecord): GatePassPdfCtx {
  const links: GatePassPdfCtx['links'] = {};
  try {
    const raw = r.machineId ? machinesForOrg(orgId).find((m) => m.id === r.machineId) : undefined;
    if (raw) {
      const machine: MachineLite = {
        orgId, id: raw.id, fleetNo: raw.fleetNo, assetNumber: raw.assetNumber,
        make: raw.make, model: raw.model, serialNumber: raw.serialNumber,
      };
      const refs = resolveReferences(machine, r.customer ?? raw.currentCustomer, snapshot(orgId));
      if (refs.quotationNo) links.quotationNo = refs.quotationNo;
      if (refs.hireAgreementNo) links.hireAgreementNo = refs.hireAgreementNo;
    }
  } catch (err) {
    console.warn('[gatePassDocs] could not resolve links', err);
  }
  if (r.direction === 'IN') {
    const note = useCollectionStore
      .getState()
      .notes.find((n) => n.orgId === orgId && n.collectedByGateId === r.id);
    if (note) links.collectionNo = note.number;
  }
  return { companyName: companyName(orgId), links };
}

function dataUrlToBlob(dataUrl: string): Blob {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) throw new Error('Invalid QR image');
  const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

/** Downloads the QR image of a gate pass as `<reference>.png`. Rejects when the image fails. */
export async function downloadGateQrPng(r: Pick<GateRecord, 'orgId' | 'id' | 'reference'>): Promise<void> {
  const url = await qrDataUrl(buildGatePayload(r));
  downloadBlob(dataUrlToBlob(url), pngFileName(r.reference));
}

/** Builds the Gate Pass PDF and downloads it as `<reference>.pdf`. Rejects when rendering fails. */
export async function printGatePass(orgId: string, r: GateRecord): Promise<void> {
  const blob = await gatePassPdf(r, gatePassContext(orgId, r));
  downloadBlob(blob, `${r.reference.replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`);
}
