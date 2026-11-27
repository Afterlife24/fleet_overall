// Maps the collection, MQD and third-party service API records to the document shapes the collection screens
// and the browser PDF renderers use (`types/collection.ts`). Reference fields come from the booking itself.
import type { CollectionNote, MissingLink, MqdRecord, ReferenceFields, ServiceLine, TpsDocument } from '@/types/collection';
import type { BookingDto } from './bookings';
import type { CollectionNoteDto } from './collection';
import type { MqdReportDto, ServiceLineDto, ServiceReportDto } from './documents';

/** Reference fields for a booking. Links the booking does not carry are left empty and reported as missing. */
export function referenceFieldsFromBooking(b: BookingDto | undefined, invoiceNo = '', invoiceId = ''): ReferenceFields {
  const missing: MissingLink[] = [];
  const refNotes: string[] = [];
  if (!b) {
    missing.push('BOOKING');
    refNotes.push('Booking could not be found');
  } else if (!b.agreementNo) {
    missing.push('AGREEMENT');
    refNotes.push('Booking has no hire agreement');
  }
  return {
    machineId: b?.machineId ?? '',
    fleetNo: b ? b.fleetNo || b.assetNo : '',
    machineDescription: b?.machineModel ?? '',
    serialNumber: '',
    customerName: b?.customerName ?? '',
    customerId: b?.customerId ?? '',
    bookingId: b?.id ?? '',
    bookingRef: b?.reference ?? '',
    hireAgreementId: b?.hireAgreementId ?? '',
    hireAgreementNo: b?.agreementNo ?? '',
    quotationId: '',
    quotationNo: '',
    invoiceId,
    invoiceNo,
    site: b?.deliveryAddress ?? '',
    missing,
    refNotes,
  };
}

export interface DocMapContext {
  orgId: string;
  bookings: ReadonlyMap<string, BookingDto>;
  /** collection note id -> number, for the collection note column of the reports */
  noteNumbers?: ReadonlyMap<string, string>;
  /** collection note id -> report ids created with it */
  mqdByNote?: ReadonlyMap<string, string>;
  tpsByNote?: ReadonlyMap<string, string>;
  invoiceNos?: ReadonlyMap<string, string>;
}

export function collectionNoteFromDto(dto: CollectionNoteDto, ctx: DocMapContext): CollectionNote {
  const booking = ctx.bookings.get(dto.bookingId);
  const invoiceNo = dto.relatedInvoiceId ? ctx.invoiceNos?.get(dto.relatedInvoiceId) ?? '' : '';
  const refs = referenceFieldsFromBooking(booking, invoiceNo, dto.relatedInvoiceId ?? '');
  return {
    ...refs,
    machineId: dto.machineId,
    id: dto.id,
    orgId: ctx.orgId,
    number: dto.number,
    cnId: dto.id,
    mqdId: ctx.mqdByNote?.get(dto.id),
    tpsId: ctx.tpsByNote?.get(dto.id),
    signedStatus: 'Pending',
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    rowVersion: dto.rowVersion,
    status: dto.status,
    date: dto.noteDate,
    collectionAddress: dto.collectionAddress,
    driver: dto.driverName,
    vehicle: dto.vehicleText,
    remarks: dto.remarks ?? '',
    collectedByGateId: dto.collectedMovementId ?? undefined,
    collectedAt: dto.collectedAt ?? undefined,
    scheduledCollectionAt: dto.scheduledCollectionAt ?? undefined,
    pickedUpAt: dto.pickedUpAt ?? undefined,
    relatedInvoiceId: dto.relatedInvoiceId ?? undefined,
  };
}

const asText = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

export function mqdFromDto(dto: MqdReportDto, ctx: DocMapContext): MqdRecord {
  const refs = referenceFieldsFromBooking(ctx.bookings.get(dto.bookingId));
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(dto.fields ?? {})) fields[k] = asText(v);
  return {
    ...refs,
    id: dto.id,
    orgId: ctx.orgId,
    number: dto.number,
    cnId: dto.collectionNoteId ?? undefined,
    signedStatus: 'Pending',
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    rowVersion: dto.rowVersion,
    phase: dto.phase,
    date: dto.reportDate,
    hirer: dto.hirerName,
    fields,
    photoKeys: [],
  };
}

export function serviceLineFromDto(l: ServiceLineDto): ServiceLine {
  return {
    id: l.id,
    provider: l.provider,
    serviceType: l.serviceType,
    description: l.description,
    date: l.serviceDate,
    reference: l.externalReference,
    quantity: Number(l.quantity),
    rate: Number(l.rate),
  };
}

export function tpsFromDto(dto: ServiceReportDto, ctx: DocMapContext): TpsDocument {
  const refs = referenceFieldsFromBooking(ctx.bookings.get(dto.bookingId));
  return {
    ...refs,
    id: dto.id,
    orgId: ctx.orgId,
    number: dto.number,
    cnId: dto.collectionNoteId ?? undefined,
    signedStatus: 'Pending',
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    rowVersion: dto.rowVersion,
    phase: dto.phase,
    currencyCode: dto.currencyCode,
    lines: dto.lines.map(serviceLineFromDto),
    notes: dto.notes ?? '',
    approvedBy: dto.approvedName ?? '',
    signature: dto.signatureText ?? '',
  };
}
