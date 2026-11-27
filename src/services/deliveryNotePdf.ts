// Delivery Note content and PDF. The snapshot below is exactly what the server stores for the document version,
// so the same inputs always render the same content. Must not import services.ts, appStore.ts or any store.
import { renderPdf, type PdfContent } from '@/services/collectionPdf';
import type { DeliveryNoteDto } from '@/services/api/documents';
import type { Booking } from '@/types/booking';

export const DN_TEMPLATE_VERSION = 'dn-1';
export const DN_SNAPSHOT_SCHEMA_VERSION = '1';

export interface DeliveryNoteSnapshot extends Record<string, unknown> {
  number: string;
  noteDate: string;
  deliveryAddress: string;
  deliveredAt: string | null;
  receivedByName: string | null;
  driverName: string | null;
  notes: string | null;
  booking: {
    reference: string;
    customerName: string;
    assetNo: string;
    fleetNo: string;
    machineModel: string;
    agreementNo: string | null;
    startDate: string;
    endDate: string;
    contactPhone: string;
  };
}

/** Builds the snapshot from the delivery note and its booking (`undefined` booking leaves the booking fields blank). */
export function deliveryNoteSnapshot(dn: DeliveryNoteDto, booking: Booking | undefined): DeliveryNoteSnapshot {
  return {
    number: dn.number,
    noteDate: dn.noteDate,
    deliveryAddress: dn.deliveryAddress,
    deliveredAt: dn.deliveredAt,
    receivedByName: dn.receivedByName,
    driverName: dn.driverName,
    notes: dn.notes,
    booking: {
      reference: dn.bookingReference,
      customerName: booking?.customerName ?? '',
      assetNo: booking?.assetNumber ?? '',
      fleetNo: booking?.fleetNo ?? '',
      machineModel: booking?.machineModel ?? '',
      agreementNo: booking?.agreementNo ?? null,
      startDate: booking?.startDate ?? '',
      endDate: booking?.endDate ?? '',
      contactPhone: booking?.contactPhone ?? '',
    },
  };
}

const dash = (v: string | null | undefined): string => (v && v.trim() !== '' ? v : '-');

export function deliveryNoteContent(s: DeliveryNoteSnapshot): PdfContent {
  return {
    title: 'Delivery Note',
    number: s.number,
    sections: [
      {
        heading: 'Delivery',
        rows: [
          ['Date', dash(s.noteDate)],
          ['Delivery Address', dash(s.deliveryAddress)],
          ['Delivered At', dash(s.deliveredAt ? s.deliveredAt.replace('T', ' ').slice(0, 16) : null)],
          ['Driver', dash(s.driverName)],
          ['Received By', dash(s.receivedByName)],
          ['Notes', dash(s.notes)],
        ],
      },
      {
        heading: 'Booking',
        rows: [
          ['Booking', dash(s.booking.reference)],
          ['Customer', dash(s.booking.customerName)],
          ['Site Contact', dash(s.booking.contactPhone)],
          ['Hire Agreement', dash(s.booking.agreementNo)],
          ['Hire Period', `${dash(s.booking.startDate)} to ${dash(s.booking.endDate)}`],
        ],
      },
      {
        heading: 'Machine',
        rows: [
          ['Asset No', dash(s.booking.assetNo)],
          ['Fleet No', dash(s.booking.fleetNo)],
          ['Machine', dash(s.booking.machineModel)],
        ],
      },
    ],
    signatures: ['Driver Signature', 'Received By (Customer)', 'Authorised Signatory'],
  };
}

export function deliveryNotePdf(s: DeliveryNoteSnapshot): Promise<Blob> {
  return renderPdf(deliveryNoteContent(s));
}
