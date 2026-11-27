// Builders for the rental-chain integration tests: machine, agreement, booking, transport job and gate helpers.
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import type { Actor, Harness } from './apiHarness.js';
import { advance, newCustomer, newQuotation, type Customer, type Quotation } from './crmFixtures.js';

export interface Machine { id: string; assetNo: string; fleetNo: string; branchId: string; rowVersion: number; operationalStatus: string; readinessStatus: string }
export interface Agreement { id: string; agreementNo: string; rowVersion: number; quotationId: string; customerId: string }
export interface Booking {
  id: string; reference: string; status: string; rowVersion: number; machineId: string; customerId: string; hireAgreementId: string | null;
  startDate: string; endDate: string; physicallyOccupied: boolean; departedAt: string | null; returnedAt: string | null;
}

let seq = 0;
const next = (): number => (seq += 1);
const models = new Map<string, string>();

/** One machine model per company, created on first use. */
async function modelFor(h: Harness, a: Actor): Promise<string> {
  const cached = models.get(a.orgId);
  if (cached) return cached;
  const res = await h.create(a, '/machine-models', { make: 'JLG', model: `600S-${next()}`, category: 'Boom Lift' });
  expect(res.status).toBe(201);
  models.set(a.orgId, res.body.id);
  return res.body.id;
}

export async function newMachine(h: Harness, a: Actor, extra: object = {}): Promise<Machine> {
  const n = next();
  const res = await h.create(a, '/machines', {
    branchId: a.branchId, modelId: await modelFor(h, a), assetNo: `RA-${n}`, fleetNo: `RF-${n}`, serialNo: `RS-${n}`,
    currentLocation: 'Main yard', ...extra,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Machine;
}

export const getMachine = async (h: Harness, a: Actor, id: string): Promise<Machine> => {
  const res = await h.call(a, 'get', `/machines/${id}`);
  expect(res.status).toBe(200);
  return res.body as Machine;
};

export async function newAgreement(h: Harness, a: Actor, q: Pick<Quotation, 'id' | 'customerId'>, extra: object = {}): Promise<Agreement> {
  const res = await h.create(a, '/hire-agreements', {
    quotationId: q.id,
    customerId: q.customerId,
    equipmentName: 'Boom lift',
    equipmentModel: 'JLG 600S',
    serialNumber: 'SN-1',
    deliveryLocation: 'Jebel Ali',
    hireStartDate: '2030-03-01',
    hireEndDate: '2030-06-30',
    monthlyRental: '1000',
    paymentTerms: '30 days from invoice',
    paymentMethod: 'Cheque',
    ...extra,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Agreement;
}

export function bookingBody(machineId: string, customerId: string, extra: object = {}): Record<string, unknown> {
  return {
    machineId, customerId, startDate: '2030-03-01', endDate: '2030-03-31', deliveryAddress: 'Jebel Ali site',
    contactPhone: '+971 50 000 0000', dailyRate: '100', ...extra,
  };
}

export async function newBooking(h: Harness, a: Actor, machineId: string, customerId: string, extra: object = {}): Promise<Booking> {
  const res = await h.create(a, '/bookings', bookingBody(machineId, customerId, extra));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Booking;
}

export const getBooking = async (h: Harness, a: Actor, id: string): Promise<Booking> => {
  const res = await h.call(a, 'get', `/bookings/${id}`);
  expect(res.status).toBe(200);
  return res.body as Booking;
};

/** POST /bookings/:id/start-hire with a fresh (or given) Idempotency-Key and the given row version. */
export function startHire(h: Harness, a: Actor, id: string, version: number, key: string = randomUUID()) {
  return h.call(a, 'post', `/bookings/${id}/start-hire`).set('Idempotency-Key', key).set('If-Match', String(version)).send({});
}

export interface Chain {
  customer: Customer;
  quotation: Quotation;
  agreement: Agreement;
  machine: Machine;
  booking: Booking;
}

/**
 * customer -> quotation -> hire agreement -> machine -> booking (default status Allocated, ready to dispatch).
 * `phase` moves the quotation from Awaiting before the agreement is made (e.g. ['WON'] or ['LOST']).
 */
export async function rentalChain(
  h: Harness,
  a: Actor,
  opts: { phase?: string[]; agreement?: object; booking?: object; machine?: object; quotation?: object; customer?: object } = {},
): Promise<Chain> {
  const customer = await newCustomer(h, a, undefined, opts.customer);
  let quotation = await newQuotation(h, a, customer.id, opts.quotation);
  const agreement = await newAgreement(h, a, quotation, opts.agreement);
  if (opts.phase && opts.phase.length > 0) quotation = { ...quotation, ...(await advance(h, a, quotation.id, opts.phase)) };
  const machine = await newMachine(h, a, opts.machine);
  const booking = await newBooking(h, a, machine.id, customer.id, {
    hireAgreementId: agreement.id, status: 'Allocated', ...opts.booking,
  });
  return { customer, quotation, agreement, machine, booking };
}

export const quotationPhase = async (h: Harness, a: Actor, id: string): Promise<string> => {
  const res = await h.call(a, 'get', `/quotations/${id}`);
  expect(res.status).toBe(200);
  return res.body.phase as string;
};

export async function phaseHistory(h: Harness, a: Actor, id: string): Promise<{ fromPhase: string | null; toPhase: string; source: string }[]> {
  const res = await h.call(a, 'get', `/quotations/${id}/history`);
  expect(res.status).toBe(200);
  return res.body.items;
}

export function jobBody(machineId: string, extra: object = {}): Record<string, unknown> {
  return {
    machineId, plannerName: 'Planner One', scheduleDate: '2030-03-01', shift: 'Morning', transportTeam: 'Team A', scheduleSerial: 1,
    origin: 'Main yard', destination: 'Jebel Ali site', transportText: 'Delivery of boom lift', typeCode: 'D',
    contactText: '+971 50 000 0000', salespersonCode: 'SP1', clientText: 'Client Co', scheduledAt: '2030-03-01T08:00:00+04:00', ...extra,
  };
}

const JOB_FORWARD = ['Scheduled', 'Loading', 'In Transit', 'Delivered', 'Returning', 'Completed'];

/** Walks a transport job forward (or cancels it) until it reaches `target`. */
export async function moveJob(h: Harness, a: Actor, job: { id: string; rowVersion: number; status: string }, target: string): Promise<void> {
  let version = job.rowVersion;
  const steps = target === 'Cancelled' ? ['Cancelled'] : JOB_FORWARD.slice(JOB_FORWARD.indexOf(job.status) + 1, JOB_FORWARD.indexOf(target) + 1);
  for (const status of steps) {
    const res = await h.change(a, 'post', `/transport-jobs/${job.id}/status`, version, { status });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    version = res.body.rowVersion;
  }
}

export function gatePassBody(machineId: string, extra: object = {}): Record<string, unknown> {
  return {
    machineId, captureMethod: 'Manual', driverName: 'Driver One', destination: 'Jebel Ali site', truckPlate: 'DXB 1234', ...extra,
  };
}

/** Creates a Pending gate pass (Gate OUT for hire by default). */
export async function newPass(h: Harness, a: Actor, body: Record<string, unknown>) {
  return h.create(a, '/gate-passes', body);
}

export function completePass(h: Harness, a: Actor, id: string, key: string = randomUUID(), body: object = {}) {
  return h.call(a, 'post', `/gate-passes/${id}/complete`).set('Idempotency-Key', key).send(body);
}

/** Pending -> (approve) -> complete Gate OUT for the booking. Returns the completion response. */
export async function gateOut(h: Harness, a: Actor, c: Pick<Chain, 'machine' | 'booking'>) {
  const pass = await newPass(h, a, gatePassBody(c.machine.id, { direction: 'OUT', movementPurpose: 'CUSTOMER_HIRE', bookingId: c.booking.id }));
  expect(pass.status, JSON.stringify(pass.body)).toBe(201);
  return completePass(h, a, pass.body.id);
}

/** Initiates collection for an On Hire booking (default: no invoice). */
export function initiateCollection(h: Harness, a: Actor, bookingId: string, body: object = {}, key: string = randomUUID()) {
  return h.call(a, 'post', `/bookings/${bookingId}/collection`).set('Idempotency-Key', key).send(body);
}

/** Gate IN (customer return) pass for the booking, optionally tied to the collection note. */
export async function gateIn(h: Harness, a: Actor, c: Pick<Chain, 'machine' | 'booking'>, collectionNoteId?: string) {
  const pass = await newPass(h, a, gatePassBody(c.machine.id, {
    direction: 'IN', movementPurpose: 'CUSTOMER_RETURN', bookingId: c.booking.id, destination: 'Main yard', arrivingFrom: 'Jebel Ali site',
    ...(collectionNoteId ? { collectionNoteId } : {}),
  }));
  expect(pass.status, JSON.stringify(pass.body)).toBe(201);
  return { pass: pass.body, complete: await completePass(h, a, pass.body.id) };
}

/** Answers every intake checklist item with `Pass` (or `Fail` for the keys listed), then returns the response. */
export async function answerInspection(
  h: Harness, a: Actor, inspectionId: string, fail: string[] = [],
) {
  const detail = await h.call(a, 'get', `/inspections/${inspectionId}`);
  expect(detail.status).toBe(200);
  const results = (detail.body.results as { itemKey: string; required: boolean; critical: boolean }[])
    .filter((r) => r.required || r.critical)
    .map((r) => ({ itemKey: r.itemKey, result: fail.includes(r.itemKey) ? 'Fail' : 'Pass' }));
  return h.change(a, 'patch', `/inspections/${inspectionId}/results`, detail.body.rowVersion, { results });
}

/** Creates a Draft invoice for the first month of a Won quotation's agreement (agreement dates 2030-03-01 .. 2030-06-30). */
export async function newInvoice(
  h: Harness, a: Actor, c: Pick<Chain, 'quotation' | 'agreement'>, extra: object = {},
): Promise<{ id: string; invoiceNo: string; rowVersion: number; customerSnapshot: Record<string, unknown> }> {
  const res = await h.create(a, '/invoices', {
    quotationId: c.quotation.id, hireAgreementId: c.agreement.id, invoiceType: 'Continuous Hire', periodStart: '2030-03-01',
    periodEnd: '2030-03-31', equipment: { quantity: '1', unitRate: '1000', amount: '1000' }, periodChargeConfirmed: true, ...extra,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

/** A tiny valid PDF with unique bytes. */
export function pdfBytes(tag: string = randomUUID()): Buffer {
  return Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(tag), Buffer.from('\n%%EOF')]);
}

/** A tiny PNG-signed payload with unique bytes (the upload check is signature and size based). */
export function pngBytes(tag: string = randomUUID()): Buffer {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(tag)]);
}
