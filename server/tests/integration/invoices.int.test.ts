// T06-T10 and T19 (suffix beyond 99): invoices against fleet_test with the runtime role (RLS) and the real auth middleware.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Actor, type Harness } from './apiHarness.js';
import { advance, newCustomer, newQuotation, type Quotation } from './crmFixtures.js';
import { newAgreement, type Agreement } from './rentalFixtures.js';

let h: Harness;
let admin: Actor; // managing-director
let salesManager: Actor; // invoices.write but not the repeat-transport / payment-report permissions
let finance: Actor;

interface Quote { quotation: Quotation; agreement: Agreement; customerId: string }

/** customer -> quotation -> agreement; the quotation is moved to `phase` (default Won). */
async function quote(agreementExtra: object = {}, phase: string[] | null = ['WON']): Promise<Quote> {
  const customer = await newCustomer(h, admin);
  const quotation = await newQuotation(h, admin, customer.id);
  const agreement = await newAgreement(h, admin, quotation, agreementExtra);
  if (phase) await advance(h, admin, quotation.id, phase);
  return { quotation, agreement, customerId: customer.id };
}

const body = (q: Quote, extra: Record<string, unknown> = {}) => ({
  quotationId: q.quotation.id,
  hireAgreementId: q.agreement.id,
  invoiceType: 'Continuous Hire',
  periodStart: '2030-03-01',
  periodEnd: '2030-03-31',
  equipment: { quantity: '1', unitRate: '1000', amount: '1000' },
  periodChargeConfirmed: true,
  ...extra,
});

const create = (a: Actor, b: object, key: string = randomUUID()) => h.create(a, '/invoices', b, key);

async function created(q: Quote, extra: Record<string, unknown> = {}, a: Actor = admin) {
  const res = await create(a, body(q, extra));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as {
    id: string; invoiceNo: string; sequenceNo: number; rowVersion: number; status: string; periodStart: string; periodEnd: string;
    subtotal: string; vatAmount: string; totalAmount: string; amountDue: string; lines: { lineType: string; quantity: string; amount: string }[];
  };
}

const sequenceRows = (quotationId: string) =>
  h.sql<{ next_value: string }>(admin, "SELECT next_value FROM number_sequences WHERE sequence_kind = 'INVOICE' AND quotation_id = $1", [quotationId]);
const invoiceRows = (quotationId: string) => h.sql(admin, 'SELECT 1 FROM invoices WHERE quotation_id = $1', [quotationId]);

beforeAll(async () => {
  h = await createHarness();
  admin = await h.actor('inv-admin', 'managing-director');
  salesManager = await h.addUser(admin, { roleCode: 'sales-manager', branchId: admin.branchId, allBranches: true });
  finance = await h.addUser(admin, { roleCode: 'finance', branchId: admin.branchId, allBranches: true });
});
afterAll(async () => {
  await h.close();
});

describe('T06 invoices need a Won quotation and consume no number when refused', () => {
  it('rejects Awaiting, Tender and Lost quotations with NOT_WON and allocates nothing', async () => {
    for (const phase of [null, ['TENDER'], ['LOST']]) {
      const q = await quote({}, phase);
      const res = await create(admin, body(q));
      expect(res.status, String(phase)).toBe(422);
      expect(res.body.code).toBe('NOT_WON');
      expect(await invoiceRows(q.quotation.id)).toHaveLength(0);
      expect(await sequenceRows(q.quotation.id)).toHaveLength(0); // the rolled-back request left no committed sequence
      const prefill = await h.call(admin, 'get', `/quotations/${q.quotation.id}/invoice-prefill?type=Continuous%20Hire`);
      expect(prefill.status).toBe(422);
      expect(prefill.body.code).toBe('NOT_WON');
    }
  });

  it('the first invoice after the quotation is won carries suffix 01 (quote number + /01)', async () => {
    const q = await quote({}, null);
    expect((await create(admin, body(q))).status).toBe(422);
    await advance(h, admin, q.quotation.id, ['WON']);
    const inv = await created(q);
    expect(inv.invoiceNo).toBe(`${q.quotation.quotationNo}/01`);
    expect(inv.sequenceNo).toBe(1);
    expect(await sequenceRows(q.quotation.id)).toEqual([{ next_value: '2' }]);
  });

  it('the database also refuses a non-Won invoice written around the API', async () => {
    const q = await quote({}, null);
    await expect(
      h.sql(
        admin,
        `INSERT INTO invoices (org_id, quotation_id, hire_agreement_id, customer_id, invoice_no, quotation_no_snapshot, agreement_no_snapshot,
           sequence_no, invoice_type, period_start, period_end, invoice_date, due_date, currency_code, issuer_snapshot, customer_snapshot,
           hire_period_text, delivery_location, payment_terms, payment_term_days, payment_method, subtotal, vat_rate, vat_amount, total_amount, amount_due)
         VALUES ($1, $2, $3, $4, 'BYPASS-1', 'Q', 'HA', 1, 'Continuous Hire', '2030-03-01', '2030-03-31', '2030-03-01', '2030-03-31', 'AED',
           '{}', '{}', 't', 'd', 'p', 0, 'm', 1, 0.05, 0.05, 1.05, 1.05)`,
        [admin.orgId, q.quotation.id, q.agreement.id, q.customerId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('requires permission, an Idempotency-Key, a confirmed period charge and a valid agreement of the quotation', async () => {
    const q = await quote();
    const driver = await h.addUser(admin, { roleCode: 'driver', branchId: admin.branchId, allBranches: true });
    expect((await create(driver, body(q))).status).toBe(403);
    expect((await h.call(admin, 'post', '/invoices').send(body(q))).status).toBe(422);
    expect((await create(admin, body(q, { periodChargeConfirmed: false }))).status).toBe(422);
    expect((await create(admin, { ...body(q), periodChargeConfirmed: undefined })).status).toBe(422);
    const other = await quote();
    const mismatch = await create(admin, body(q, { hireAgreementId: other.agreement.id }));
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.fieldErrors.hireAgreementId).toBe('quotation_mismatch');
    expect(await invoiceRows(q.quotation.id)).toHaveLength(0);

    // Client-sent totals are ignored; replay with the same key returns the same invoice.
    const key = randomUUID();
    const first = await create(admin, body(q, { subtotal: '1', vatAmount: '1', totalAmount: '1', amountDue: '1' }), key);
    const replay = await create(admin, body(q, { subtotal: '1', vatAmount: '1', totalAmount: '1', amountDue: '1' }), key);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ subtotal: '1000.000000', vatAmount: '50.000000', totalAmount: '1050.000000', amountDue: '1050.000000' });
    expect(replay.body.id).toBe(first.body.id);
    expect(await invoiceRows(q.quotation.id)).toHaveLength(1);
  });
});

describe('T07 concurrent invoice period requests', () => {
  it('four simultaneous requests for the same period: one invoice, no duplicate, no consumed numbers', async () => {
    const q = await quote();
    const results = await Promise.all(Array.from({ length: 4 }, () => create(admin, body(q))));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
    for (const r of results.filter((x) => x.status === 409)) expect(r.body.code).toBe('PERIOD_CONFLICT');
    expect(await invoiceRows(q.quotation.id)).toHaveLength(1);
    expect(await sequenceRows(q.quotation.id)).toEqual([{ next_value: '2' }]); // losers rolled back their numbers
    const win = results.find((r) => r.status === 201);
    expect(win?.body.invoiceNo).toBe(`${q.quotation.quotationNo}/01`);
  });

  it('simultaneous requests for consecutive periods produce a gap-free, overlap-free sequence', async () => {
    const q = await quote({ hireEndDate: '2030-12-31' });
    const first = await created(q);
    const next = (start: string, end: string) => create(admin, body(q, { periodStart: start, periodEnd: end }));
    const results = await Promise.all([next('2030-04-01', '2030-04-30'), next('2030-04-01', '2030-04-30'), next('2030-04-01', '2030-04-15')]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    const rows = await h.sql<{ period_start: string; period_end: string; sequence_no: string }>(
      admin,
      "SELECT to_char(period_start, 'YYYY-MM-DD') AS period_start, to_char(period_end, 'YYYY-MM-DD') AS period_end, sequence_no FROM invoices WHERE quotation_id = $1 ORDER BY sequence_no",
      [q.quotation.id],
    );
    expect(rows.map((r) => Number(r.sequence_no))).toEqual([1, 2]);
    expect(rows[0].period_start).toBe('2030-03-01');
    expect(rows[1].period_start > rows[0].period_end).toBe(true);
    expect(first.sequenceNo).toBe(1);
  });

  it('refuses overlapping and gapped periods and a period past the hire end; invoice numbers are unique per quotation and company', async () => {
    const q = await quote({ hireEndDate: '2030-05-31' });
    await created(q);
    const overlap = await create(admin, body(q, { periodStart: '2030-03-31', periodEnd: '2030-04-30' }));
    expect(overlap.status).toBe(409);
    expect(overlap.body.code).toBe('PERIOD_CONFLICT');
    const gap = await create(admin, body(q, { periodStart: '2030-04-05', periodEnd: '2030-04-30' }));
    expect(gap.status).toBe(422);
    expect(gap.body.fieldErrors.periodStart).toBe('gap');
    const past = await create(admin, body(q, { periodStart: '2030-04-01', periodEnd: '2030-06-30' }));
    expect(past.status).toBe(422);
    expect(past.body.fieldErrors.periodEnd).toBe('after_hire_end');
    const second = await created(q, { periodStart: '2030-04-01', periodEnd: '2030-04-30' });
    expect(second.invoiceNo).toMatch(/\/02$/);
    // Another quotation in the same company also starts at /01 under its own quote number.
    const other = await quote();
    expect((await created(other)).invoiceNo).toBe(`${other.quotation.quotationNo}/01`);
    const numbers = await h.sql<{ invoice_no: string }>(admin, 'SELECT invoice_no FROM invoices');
    expect(new Set(numbers.map((n) => n.invoice_no)).size).toBe(numbers.length);
  });
});

describe('T08 Continuous versus Off-Hire periods', () => {
  it('Continuous Hire takes the employee end date within the hire dates; prefill suggests a capped month', async () => {
    const q = await quote({ hireEndDate: '2030-04-15' });
    const prefill = await h.call(admin, 'get', `/quotations/${q.quotation.id}/invoice-prefill?type=Continuous%20Hire`);
    expect(prefill.status).toBe(200);
    expect(prefill.body).toMatchObject({
      periodStart: '2030-03-01', periodEnd: null, suggestedPeriodEnd: '2030-03-31', hireStartDate: '2030-03-01', hireEndDate: '2030-04-15',
      paymentTermDays: 30, currencyCode: 'AED',
    });
    expect((await create(admin, body(q, { periodEnd: undefined }))).body.fieldErrors.periodEnd).toBe('required');
    expect((await create(admin, body(q, { periodEnd: '2030-02-28' }))).body.fieldErrors.periodEnd).toBe('before_start');
    expect((await create(admin, body(q, { periodEnd: '2030-04-16' }))).body.fieldErrors.periodEnd).toBe('after_hire_end');
    const mid = await created(q, { periodEnd: '2030-03-15' }); // the employee's own end
    expect(mid.periodEnd).toBe('2030-03-15');
    const next = await h.call(admin, 'get', `/quotations/${q.quotation.id}/invoice-prefill?type=Continuous%20Hire`);
    expect(next.body).toMatchObject({ periodStart: '2030-03-16', suggestedPeriodEnd: '2030-04-15' }); // capped at the hire end
    const last = await created(q, { periodStart: '2030-03-16', periodEnd: '2030-04-15' });
    expect(last.periodEnd).toBe('2030-04-15');
    // Final: the whole hire period is billed.
    const done = await h.call(admin, 'get', `/quotations/${q.quotation.id}/invoice-prefill?type=Continuous%20Hire`);
    expect(done.status).toBe(422);
    expect(done.body.fieldErrors.periodStart).toBe('nothing_to_bill');
    expect((await create(admin, body(q, { periodStart: '2030-04-16', periodEnd: '2030-04-16' }))).status).toBe(422);
  });

  it('Off-Hire ends on the agreement end, read-only, and only once the hire has ended; nothing follows it', async () => {
    const future = await quote();
    const early = await create(admin, body(future, { invoiceType: 'Off-Hire', periodEnd: undefined }));
    expect(early.status).toBe(422);
    expect(early.body.fieldErrors.invoiceType).toBe('off_hire_not_due');

    const q = await quote({ hireStartDate: '2024-01-01', hireEndDate: '2024-06-30' });
    const prefill = await h.call(admin, 'get', `/quotations/${q.quotation.id}/invoice-prefill?type=Off-Hire`);
    expect(prefill.status).toBe(200);
    expect(prefill.body).toMatchObject({ periodStart: '2024-01-01', periodEnd: '2024-06-30', suggestedPeriodEnd: '2024-06-30' });
    const wrongEnd = await create(admin, body(q, { invoiceType: 'Off-Hire', periodStart: '2024-01-01', periodEnd: '2024-05-31' }));
    expect(wrongEnd.status).toBe(422);
    expect(wrongEnd.body.fieldErrors.periodEnd).toBe('not_allowed');
    const off = await created(q, { invoiceType: 'Off-Hire', periodStart: '2024-01-01', periodEnd: undefined });
    expect(off.periodEnd).toBe('2024-06-30');
    const after = await create(admin, body(q, { periodStart: '2024-07-01', periodEnd: '2024-07-02' }));
    expect(after.status).toBe(422);
    expect(after.body.fieldErrors.invoiceType).toBe('already_off_hired');
  });

  it('an Off-Hire invoice after Continuous periods starts after the last one and ends on the agreement end', async () => {
    const q = await quote({ hireStartDate: '2024-01-01', hireEndDate: '2024-03-31' });
    await created(q, { periodStart: '2024-01-01', periodEnd: '2024-02-10' });
    const off = await created(q, { invoiceType: 'Off-Hire', periodStart: '2024-02-11', periodEnd: '2024-03-31' });
    expect(off).toMatchObject({ periodStart: '2024-02-11', periodEnd: '2024-03-31', sequenceNo: 2 });
  });
});

describe('T09 quantity, decimal totals, transport carry-over and the recorded balance', () => {
  it('prefills the agreement quantity and computes decimal totals on the server', async () => {
    const q = await quote({ quantity: 3, monthlyRental: '1234.567', transportationCharges: '250', hireEndDate: '2030-12-31' });
    const prefill = (await h.call(admin, 'get', `/quotations/${q.quotation.id}/invoice-prefill?type=Continuous%20Hire`)).body;
    expect(prefill.equipment).toMatchObject({ quantity: '3', unitRate: '1234.567000', amount: '3703.70' });
    expect(prefill.transport).toMatchObject({ amount: '250.00', repeatRequiresConfirmation: false });

    const inv = await created(q, {
      equipment: { quantity: '3', unitRate: '1234.567', amount: '3703.70' }, transport: { amount: '100.10' },
    });
    expect(inv).toMatchObject({ subtotal: '3803.800000', vatAmount: '190.190000', totalAmount: '3993.990000', amountDue: '3993.990000' });
    expect(inv.lines).toEqual([
      expect.objectContaining({ lineType: 'EQUIPMENT', quantity: '3.000000', amount: '3703.700000' }),
      expect.objectContaining({ lineType: 'TRANSPORT', quantity: '1.000000', amount: '100.100000' }),
    ]);
    // Tax is an exact decimal rounded half-up to the currency precision (no float drift): 0.30 * 5% = 0.015 -> 0.02.
    const tiny = await quote();
    const t = await created(tiny, { equipment: { quantity: '1', unitRate: '0.30', amount: '0.30' } });
    expect(t).toMatchObject({ subtotal: '0.300000', vatAmount: '0.020000', totalAmount: '0.320000' });
    expect((await create(admin, body(tiny, { periodStart: '2030-04-01', periodEnd: '2030-04-02', equipment: { quantity: '0', unitRate: '1', amount: '1' } }))).status).toBe(422);
  });

  it('transport defaults to zero after the first active invoice; a repeat charge needs confirmation, permission and is audited', async () => {
    const q = await quote({ transportationCharges: '250', hireEndDate: '2030-12-31' });
    const first = await created(q, { transport: { amount: '250' } });
    expect(first.lines.map((l) => l.lineType)).toEqual(['EQUIPMENT', 'TRANSPORT']);
    const prefill = (await h.call(admin, 'get', `/quotations/${q.quotation.id}/invoice-prefill?type=Continuous%20Hire`)).body;
    expect(prefill.transport).toMatchObject({ amount: '0.00', repeatRequiresConfirmation: true });

    const p2 = { periodStart: '2030-04-01', periodEnd: '2030-04-30' };
    const none = await created(q, p2); // no transport: only the equipment line
    expect(none.lines.map((l) => l.lineType)).toEqual(['EQUIPMENT']);
    const p3 = { periodStart: '2030-05-01', periodEnd: '2030-05-31', transport: { amount: '250' } };
    const unconfirmed = await create(admin, body(q, p3));
    expect(unconfirmed.status).toBe(422);
    expect(unconfirmed.body.fieldErrors.repeatTransportConfirmed).toBe('required');
    const unauthorised = await create(salesManager, body(q, { ...p3, repeatTransportConfirmed: true }));
    expect(unauthorised.status).toBe(403);
    expect(await invoiceRows(q.quotation.id)).toHaveLength(2);
    const ok = await create(finance, body(q, { ...p3, repeatTransportConfirmed: true }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.lines.map((l: { lineType: string }) => l.lineType)).toEqual(['EQUIPMENT', 'TRANSPORT']);
    expect((await h.audit(admin, 'invoice.transport_repeat_confirmed')).some((e) => e.actor_user_id === finance.userId)).toBe(true);
  });

  it('editing an issued invoice never resets the externally reported balance', async () => {
    const q = await quote();
    const inv = await created(q);
    const issued = await h.change(admin, 'post', `/invoices/${inv.id}/issue`, inv.rowVersion, {});
    expect(issued.status).toBe(200);
    expect(issued.body.status).toBe('Sent');
    expect((await h.change(salesManager, 'post', `/invoices/${inv.id}/payment-status`, issued.body.rowVersion, {
      status: 'Overdue', amountDue: '300', reason: 'Part payment received',
    })).status).toBe(403);
    const reported = await h.change(finance, 'post', `/invoices/${inv.id}/payment-status`, issued.body.rowVersion, {
      status: 'Overdue', amountDue: '300', reason: 'Part payment received',
    });
    expect(reported.status, JSON.stringify(reported.body)).toBe(200);
    expect(reported.body).toMatchObject({ status: 'Overdue', amountDue: '300.000000' });

    const note = await h.change(admin, 'patch', `/invoices/${inv.id}`, reported.body.rowVersion, { notes: 'Chased by phone' });
    expect(note.status).toBe(200);
    expect(note.body).toMatchObject({ notes: 'Chased by phone', amountDue: '300.000000', status: 'Overdue', totalAmount: '1050.000000' });
    // Echoing the identity fields is fine; trying to change them is not.
    expect((await h.change(admin, 'patch', `/invoices/${inv.id}`, note.body.rowVersion, { notes: 'x', amountDue: '300' })).status).toBe(200);
    const reset = await h.change(admin, 'patch', `/invoices/${inv.id}`, note.body.rowVersion + 1, { notes: 'x', amountDue: '1050' });
    expect(reset.status).toBe(422);
    expect(reset.body.code).toBe('IMMUTABLE_FIELD');
    expect((await h.call(admin, 'get', `/invoices/${inv.id}`)).body.amountDue).toBe('300.000000');
    // Validation of the reported state.
    const paid = await h.change(finance, 'post', `/invoices/${inv.id}/payment-status`, note.body.rowVersion + 1, { status: 'Paid', amountDue: '5', reason: 'x' });
    expect(paid.status).toBe(422);
    expect((await h.change(finance, 'post', `/invoices/${inv.id}/payment-status`, note.body.rowVersion + 1, { status: 'Overdue', amountDue: '99999', reason: 'x' })).status).toBe(422);
  });
});

describe('T10 Draft cancellation is latest-only and issued invoices are protected', () => {
  it('only the latest Draft can be cancelled; its coverage is released and its number is never reused', async () => {
    const q = await quote({ hireEndDate: '2030-12-31' });
    const one = await created(q);
    const two = await created(q, { periodStart: '2030-04-01', periodEnd: '2030-04-30' });
    const notLatest = await h.change(admin, 'post', `/invoices/${one.id}/cancel`, one.rowVersion, { reason: 'wrong' });
    expect(notLatest.status).toBe(422);
    expect(notLatest.body.fieldErrors.id).toBe('not_latest');
    expect((await h.change(admin, 'patch', `/invoices/${one.id}`, one.rowVersion, { equipment: { amount: '10' }, periodChargeConfirmed: true })).status).toBe(422);
    expect((await h.change(admin, 'post', `/invoices/${two.id}/cancel`, two.rowVersion, { reason: '' })).status).toBe(422);
    const cancelled = await h.change(admin, 'post', `/invoices/${two.id}/cancel`, two.rowVersion, { reason: 'Billed wrong period' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ status: 'Cancelled', cancellationReason: 'Billed wrong period' });
    expect((await h.audit(admin, 'invoice.cancelled')).at(-1)?.reason).toBe('Billed wrong period');

    // Coverage is free again; the new invoice gets a new suffix and sequence, the cancelled number stays.
    const redo = await created(q, { periodStart: '2030-04-01', periodEnd: '2030-04-30' });
    expect(redo.invoiceNo).toBe(`${q.quotation.quotationNo}/03`);
    expect(redo.sequenceNo).toBe(3);
    const all = await h.sql<{ invoice_no: string; status: string }>(admin, 'SELECT invoice_no, status FROM invoices WHERE quotation_id = $1 ORDER BY sequence_no', [q.quotation.id]);
    expect(all.map((r) => r.status)).toEqual(['Draft', 'Cancelled', 'Draft']);
    expect(new Set(all.map((r) => r.invoice_no)).size).toBe(3);
    // A cancelled invoice cannot be edited or issued again.
    expect((await h.change(admin, 'patch', `/invoices/${two.id}`, cancelled.body.rowVersion, { notes: 'x' })).status).toBe(422);
    expect((await h.change(admin, 'post', `/invoices/${two.id}/issue`, cancelled.body.rowVersion, {})).status).toBe(422);
  });

  it('a latest Draft is recomputed with a confirmed charge; an issued invoice keeps its totals and cannot be cancelled', async () => {
    const q = await quote();
    const inv = await created(q);
    expect((await h.change(admin, 'patch', `/invoices/${inv.id}`, inv.rowVersion, { equipment: { amount: '2000', unitRate: '2000' } })).body.fieldErrors.periodChargeConfirmed).toBe('required');
    const edit = await h.change(admin, 'patch', `/invoices/${inv.id}`, inv.rowVersion, {
      equipment: { amount: '2000', unitRate: '2000' }, periodChargeConfirmed: true, transport: { amount: '50' },
    });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    expect(edit.body).toMatchObject({ subtotal: '2050.000000', vatAmount: '102.500000', totalAmount: '2152.500000', amountDue: '2152.500000' });
    expect((await h.change(admin, 'patch', `/invoices/${inv.id}`, 1, { notes: 'stale' })).status).toBe(409);

    const issued = await h.change(admin, 'post', `/invoices/${inv.id}/issue`, edit.body.rowVersion, {});
    expect(issued.status).toBe(200);
    expect(issued.body.issuedAt).toEqual(expect.any(String));
    for (const patch of [
      { equipment: { amount: '1' }, periodChargeConfirmed: true }, { transport: null }, { invoiceDate: '2031-01-01' },
    ]) {
      const res = await h.change(admin, 'patch', `/invoices/${inv.id}`, issued.body.rowVersion, patch);
      expect(res.status, JSON.stringify(patch)).toBe(422);
      expect(res.body.code).toBe('IMMUTABLE_FIELD');
    }
    const cancel = await h.change(admin, 'post', `/invoices/${inv.id}/cancel`, issued.body.rowVersion, { reason: 'oops' });
    expect(cancel.status).toBe(422);
    expect(cancel.body.code).toBe('INVALID_TRANSITION');
    expect((await h.change(admin, 'post', `/invoices/${inv.id}/issue`, issued.body.rowVersion, {})).status).toBe(422);
    const final = (await h.call(admin, 'get', `/invoices/${inv.id}`)).body;
    expect(final).toMatchObject({ status: 'Sent', subtotal: '2050.000000', totalAmount: '2152.500000', amountDue: '2152.500000' });
    // Snapshots stay as created even when masters change.
    await h.sql(admin, "UPDATE organizations SET name = 'Renamed Lessor' WHERE id = $1", [admin.orgId]);
    expect((await h.call(admin, 'get', `/invoices/${inv.id}`)).body.issuerSnapshot).toEqual(final.issuerSnapshot);
  });
});

describe('T19 invoice suffix growth', () => {
  it('suffix 100 works and numbers stay unique and ordered', async () => {
    const q = await quote({ hireEndDate: '2030-12-31' });
    await created(q); // 01
    await h.sql(admin, "UPDATE number_sequences SET next_value = 99 WHERE sequence_kind = 'INVOICE' AND quotation_id = $1", [q.quotation.id]);
    const a = await created(q, { periodStart: '2030-04-01', periodEnd: '2030-04-30' });
    const b = await created(q, { periodStart: '2030-05-01', periodEnd: '2030-05-31' });
    expect(a.invoiceNo).toBe(`${q.quotation.quotationNo}/99`);
    expect(b.invoiceNo).toBe(`${q.quotation.quotationNo}/100`);
    expect(await sequenceRows(q.quotation.id)).toEqual([{ next_value: '101' }]);
  });
});
