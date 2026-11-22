// Gate Pass PDF content and rendering. Must not import services.ts, appStore.ts or any store.
import { renderPdf, type PdfContent } from '@/services/collectionPdf';
import { buildGatePayload } from '@/services/gatePassCore';
import { formatGateWhen } from '@/services/gateCore';
import type { GateRecord } from '@/types/gate';

export interface GatePassPdfCtx {
  companyName: string;
  links: { quotationNo?: string; hireAgreementNo?: string; collectionNo?: string };
}

const dash = (v: string | undefined | null): string => (v && v.trim() !== '' ? v : '-');

/** Pure. Sections: Pass, Machine, Parties, References. `qr` is the gate payload. */
export function gatePassContent(r: GateRecord, ctx: GatePassPdfCtx): PdfContent {
  const when = formatGateWhen(r);
  const fleetNo = r.fleetNo || r.assetNumber;
  return {
    title: 'Gate Pass',
    number: r.reference,
    sections: [
      {
        heading: 'Pass',
        rows: [
          ['Company', dash(ctx.companyName)],
          ['Reference', dash(r.reference)],
          ['Direction', r.direction === 'IN' ? 'IN - Machine arriving' : 'OUT - Machine departing'],
          ['Status', dash(r.status)],
          ['Gate Date', when.available ? dash(when.date) : 'Not available'],
          ['Gate Time', when.available ? `${dash(when.time)} ${when.zone ?? ''}`.trim() : 'Not available'],
        ],
      },
      {
        heading: 'Machine',
        rows: [
          ['Fleet No', dash(fleetNo)],
          ['Make / Model', dash(r.machineModel)],
        ],
      },
      {
        heading: 'Parties',
        rows: [
          ['Customer', dash(r.customer)],
          ['Driver', dash(r.driver)],
          ['Truck Plate', dash(r.truckPlate)],
          ['Branch', dash(r.branchName)],
        ],
      },
      {
        heading: 'References',
        rows: [
          ['Quotation', dash(ctx.links.quotationNo)],
          ['Hire Agreement', dash(ctx.links.hireAgreementNo)],
          ['Collection Note', dash(ctx.links.collectionNo)],
        ],
      },
    ],
    qr: buildGatePayload(r),
    qrCaption: dash(fleetNo),
    signatures: ['Gate Officer', 'Driver'],
  };
}

export async function gatePassPdf(r: GateRecord, ctx: GatePassPdfCtx): Promise<Blob> {
  return renderPdf(gatePassContent(r, ctx));
}
