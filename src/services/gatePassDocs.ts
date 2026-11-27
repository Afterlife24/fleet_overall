// Gate pass document facade: builds the PDF context and downloads the browser-rendered files.
// The pass, its booking and its numbers come from the API (the caller passes them in); this module reads no store.
import { downloadBlob, qrDataUrl } from '@/services/collectionPdf';
import { buildGatePayload, pngFileName } from '@/services/gatePassCore';
import { gatePassPdf, type GatePassPdfCtx } from '@/services/gatePassPdf';
import type { GateRecord } from '@/types/gate';

/** PDF context: the company name and the linked document numbers the caller already read from the API. */
export function gatePassContext(companyName: string, links: GatePassPdfCtx['links'] = {}): GatePassPdfCtx {
  const clean: GatePassPdfCtx['links'] = {};
  if (links.quotationNo) clean.quotationNo = links.quotationNo;
  if (links.hireAgreementNo) clean.hireAgreementNo = links.hireAgreementNo;
  if (links.collectionNo) clean.collectionNo = links.collectionNo;
  return { companyName, links: clean };
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

/** Builds the Gate Pass PDF in the browser and downloads it as `<reference>.pdf`. Rejects when rendering fails. */
export async function printGatePass(r: GateRecord, ctx: GatePassPdfCtx): Promise<void> {
  const blob = await gatePassPdf(r, ctx);
  downloadBlob(blob, `${r.reference.replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`);
}
