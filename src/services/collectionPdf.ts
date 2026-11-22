// PDF content builders and rendering for collection documents.
// Must not import services.ts, appStore.ts or any store.
import { buildQrPayload, lineAmount, tpsTotal } from '@/services/collectionCore';
import type { MachineLite } from '@/services/collectionCore';
import type {
  CollectionNote,
  MqdRecord,
  ReferenceFields,
  TpsDocument,
} from '@/types/collection';

export interface PdfContent {
  title: string;
  number: string;
  sections: { heading: string; rows: [string, string][] }[];
  table?: { head: string[]; rows: string[][]; footer?: string[] };
  qr?: string;
  /** Printed under the QR code (fleet number). */
  qrCaption?: string;
  signatures: string[];
}

const dash = (v: string | undefined | null): string => (v && v.trim() !== '' ? v : '-');
const money = (n: number): string => n.toFixed(2);

function referenceRows(r: ReferenceFields): { heading: string; rows: [string, string][] }[] {
  const refRows: [string, string][] = [
    ['Quotation', dash(r.quotationNo)],
    ['Invoice', dash(r.invoiceNo)],
    ['Hire Agreement', dash(r.hireAgreementNo)],
    ['Booking', dash(r.bookingRef)],
  ];
  const notes = (r.refNotes ?? []).filter((n) => n && n.trim() !== '');
  if (notes.length > 0) refRows.push(['Notes', notes.join('; ')]);
  return [
    { heading: 'References', rows: refRows },
    {
      heading: 'Customer',
      rows: [
        ['Customer', dash(r.customerName)],
        ['Site', dash(r.site)],
      ],
    },
    {
      heading: 'Fleet',
      rows: [
        ['Fleet No', dash(r.fleetNo)],
        ['Machine', dash(r.machineDescription)],
        ['Serial No', dash(r.serialNumber)],
      ],
    },
  ];
}

export function collectionNoteContent(cn: CollectionNote): PdfContent {
  const qr = buildQrPayload({
    id: cn.machineId,
    orgId: cn.orgId,
    fleetNo: cn.fleetNo,
    assetNumber: cn.fleetNo,
  });
  return {
    title: 'Collection Note',
    number: cn.number,
    sections: [
      {
        heading: 'Collection',
        rows: [
          ['Date', dash(cn.date)],
          ['Status', dash(cn.status)],
          ['Collection Address', dash(cn.collectionAddress)],
          ['Driver', dash(cn.driver)],
          ['Vehicle', dash(cn.vehicle)],
          ['Remarks', dash(cn.remarks)],
        ],
      },
      ...referenceRows(cn),
    ],
    qr,
    qrCaption: dash(cn.fleetNo),
    signatures: ['Driver Signature', 'Customer Signature', 'Authorised Signatory'],
  };
}

export function mqdContent(mqd: MqdRecord): PdfContent {
  const fieldRows: [string, string][] = Object.entries(mqd.fields ?? {}).map(
    ([k, v]) => [k, dash(v)] as [string, string],
  );
  return {
    title: 'Machine Quality Document',
    number: mqd.number,
    sections: [
      {
        heading: 'Document',
        rows: [
          ['Date', dash(mqd.date)],
          ['Hirer', dash(mqd.hirer)],
        ],
      },
      ...referenceRows(mqd),
      { heading: 'Inspection', rows: fieldRows },
      {
        heading: 'Off-Hire Sign-off',
        rows: [
          ['Hirer', dash(mqd.hirer)],
          ['Date', dash(mqd.date)],
        ],
      },
    ],
    signatures: ['Inspector Signature', 'Hirer Off-Hire Sign-off'],
  };
}

export function tpsContent(tps: TpsDocument): PdfContent {
  const total = tpsTotal(tps.lines);
  return {
    title: 'Third-Party Services',
    number: tps.number,
    sections: [
      ...referenceRows(tps),
      {
        heading: 'Approval',
        rows: [
          ['Approved By', dash(tps.approvedBy)],
          ['Signature', dash(tps.signature)],
          ['Notes', dash(tps.notes)],
        ],
      },
    ],
    table: {
      head: ['Provider', 'Type', 'Description', 'Date', 'Ref/PO', 'Qty', 'Rate', 'Amount'],
      rows: tps.lines.map((l) => [
        l.provider,
        l.serviceType,
        l.description,
        l.date,
        l.reference,
        String(l.quantity),
        money(l.rate),
        money(lineAmount(l)),
      ]),
      footer: ['Total', '', '', '', '', '', '', money(total)],
    },
    signatures: ['Approved By', 'Provider Signature'],
  };
}

// ---------------------------------------------------------------- rendering

const BLUE: [number, number, number] = [30, 64, 175];
const QR_SIZE_MM = 38; // >= 35mm

export async function qrDataUrl(payload: string): Promise<string> {
  const mod = await import('qrcode');
  const toDataURL = mod.toDataURL ?? (mod as unknown as { default: typeof mod }).default.toDataURL;
  return toDataURL(payload, { errorCorrectionLevel: 'M', margin: 1, width: 400 });
}

export async function renderPdf(content: PdfContent): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  const bottom = pageH - 16;
  let y = 0;

  const header = () => {
    doc.setFillColor(...BLUE);
    doc.rect(0, 0, pageW, 24, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(content.title, margin, 15);
    doc.setFontSize(11);
    doc.text(content.number, pageW - margin, 15, { align: 'right' });
    doc.setTextColor(30, 30, 30);
    y = 34;
  };
  const ensure = (h: number) => {
    if (y + h > bottom) {
      doc.addPage();
      header();
    }
  };

  header();

  for (const s of content.sections) {
    ensure(14);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...BLUE);
    doc.text(s.heading, margin, y);
    doc.setDrawColor(...BLUE);
    doc.line(margin, y + 1.5, pageW - margin, y + 1.5);
    y += 7;
    doc.setTextColor(30, 30, 30);
    doc.setFontSize(10);
    for (const [label, value] of s.rows) {
      const lines: string[] = doc.splitTextToSize(value, pageW - margin * 2 - 52);
      ensure(lines.length * 5 + 2);
      doc.setFont('helvetica', 'bold');
      doc.text(label, margin, y);
      doc.setFont('helvetica', 'normal');
      doc.text(lines, margin + 52, y);
      y += lines.length * 5 + 1;
    }
    y += 4;
  }

  if (content.table) {
    const t = content.table;
    const usable = pageW - margin * 2;
    const widths = t.head.map((_, i) => (i === 2 ? usable * 0.22 : usable * (0.78 / (t.head.length - 1))));
    const drawRow = (cells: string[], bold: boolean, fill: boolean) => {
      doc.setFontSize(8);
      const wrapped = cells.map((c, i) => doc.splitTextToSize(c ?? '', widths[i] - 2) as string[]);
      const h = Math.max(...wrapped.map((w) => w.length)) * 4 + 3;
      ensure(h);
      if (fill) {
        doc.setFillColor(...BLUE);
        doc.rect(margin, y - 4, usable, h, 'F');
        doc.setTextColor(255, 255, 255);
      } else {
        doc.setTextColor(30, 30, 30);
      }
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      let x = margin;
      wrapped.forEach((w, i) => {
        doc.text(w, x + 1, y);
        x += widths[i];
      });
      doc.setTextColor(30, 30, 30);
      y += h;
    };
    drawRow(t.head, true, true);
    for (const r of t.rows) drawRow(r, false, false);
    if (t.footer) drawRow(t.footer, true, false);
    y += 6;
  }

  if (content.qr) {
    ensure(QR_SIZE_MM + 12);
    const qrImg = content.qr.startsWith('data:image/') ? content.qr : await qrDataUrl(content.qr);
    doc.addImage(qrImg, 'PNG', margin, y, QR_SIZE_MM, QR_SIZE_MM);
    if (content.qrCaption) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(content.qrCaption, margin + QR_SIZE_MM / 2, y + QR_SIZE_MM + 5, { align: 'center' });
    }
    y += QR_SIZE_MM + 12;
  }

  if (content.signatures.length > 0) {
    ensure(28);
    y += 10;
    const n = content.signatures.length;
    const gap = 8;
    const w = (pageW - margin * 2 - gap * (n - 1)) / n;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setDrawColor(80, 80, 80);
    content.signatures.forEach((label, i) => {
      const x = margin + i * (w + gap);
      doc.line(x, y, x + w, y);
      doc.text(label, x, y + 5);
      doc.text('Date:', x, y + 10);
    });
  }

  return doc.output('blob');
}

export async function collectionNotePdf(cn: CollectionNote, machine?: MachineLite): Promise<Blob> {
  const content = collectionNoteContent(cn);
  if (machine) content.qr = buildQrPayload(machine);
  return renderPdf(content);
}

export async function mqdPdf(mqd: MqdRecord): Promise<Blob> {
  return renderPdf(mqdContent(mqd));
}

export async function tpsPdf(tps: TpsDocument): Promise<Blob> {
  return renderPdf(tpsContent(tps));
}

export function downloadBlob(blob: Blob, fileName: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
