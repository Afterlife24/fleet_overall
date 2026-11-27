// Task 6.7: database constraints, exercised with direct SQL as the runtime role (fleet_app) under a Tenant_Context.
// Seeding of organizations/users runs as the table owner; every business row below is written by fleet_app.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { appUrl, attempt, inTenant, migrateTestDb, seedOrg, type SeededOrg } from './testDb.js';

let url: string;
let A: SeededOrg;
let B: SeededOrg;

const uid = () => randomUUID().slice(0, 8);

async function insertCustomer(c: pg.Client, org: SeededOrg): Promise<string> {
  const id = randomUUID();
  await c.query(
    `INSERT INTO customers (id, org_id, customer_code, name, phone, address) VALUES ($1, $2, $3, 'Cust', '+971', 'Addr')`,
    [id, org.orgId, `C-${uid()}`],
  );
  return id;
}

async function insertQuotation(c: pg.Client, org: SeededOrg, customerId: string): Promise<string> {
  const id = randomUUID();
  await c.query(
    `INSERT INTO quotations (id, org_id, customer_id, quotation_no, opportunity, amount, currency_code)
     VALUES ($1, $2, $3, $4, 'Opp', 1000, 'AED')`,
    [id, org.orgId, customerId, `Q-${uid()}`],
  );
  return id;
}

async function insertAgreement(
  c: pg.Client,
  org: SeededOrg,
  quotationId: string,
  customerId: string,
  status = 'Draft',
): Promise<string> {
  const id = randomUUID();
  await c.query(
    `INSERT INTO hire_agreements (id, org_id, quotation_id, customer_id, agreement_no, agreement_date, status,
       issuer_snapshot, customer_snapshot, equipment_name, equipment_model, serial_number, capacity, working_height,
       delivery_location, hire_start_date, hire_end_date, hire_duration, monthly_rental, transportation_charges,
       subtotal, vat_amount, total_amount, payment_terms, payment_method)
     VALUES ($1, $2, $3, $4, $5, '2026-01-01', $6, '{}', '{}', 'Boom', 'M1', 'S1', '1t', '12m', 'Site',
       '2026-01-01', '2026-03-31', '3 months', 100, 10, 110, 5.5, 115.5, 'Net 30', 'Transfer')`,
    [id, org.orgId, quotationId, customerId, `HA-${uid()}`, status],
  );
  return id;
}

async function insertMachine(c: pg.Client, org: SeededOrg, branchId = org.branchId): Promise<string> {
  const modelId = randomUUID();
  const id = randomUUID();
  await c.query(`INSERT INTO machine_models (id, org_id, make, model, category) VALUES ($1, $2, $3, 'M', 'Boom')`, [
    modelId,
    org.orgId,
    `Make-${uid()}`,
  ]);
  await c.query(
    `INSERT INTO machines (id, org_id, branch_id, model_id, asset_no, fleet_no, serial_no, current_location)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'Yard')`,
    [id, org.orgId, branchId, modelId, `AS-${uid()}`, `FL-${uid()}`, `SN-${uid()}`],
  );
  return id;
}

async function insertBooking(
  c: pg.Client,
  org: SeededOrg,
  machineId: string,
  customerId: string,
  start: string,
  end: string,
  status: string,
  extra: { departed?: string; returned?: string } = {},
): Promise<string> {
  const id = randomUUID();
  await c.query(
    `INSERT INTO bookings (id, org_id, reference, branch_id, machine_id, customer_id, start_date, end_date, status,
       delivery_address, contact_phone, departed_at, returned_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Site', '+971', $10, $11)`,
    [id, org.orgId, `BK-${uid()}`, org.branchId, machineId, customerId, start, end, status, extra.departed ?? null, extra.returned ?? null],
  );
  return id;
}

async function insertFile(c: pg.Client, org: SeededOrg): Promise<string> {
  const id = randomUUID();
  await c.query(
    `INSERT INTO files (id, org_id, object_key, original_name, declared_mime, expected_size, uploaded_by)
     VALUES ($1, $2, $3, 'a.pdf', 'application/pdf', 10, $4)`,
    [id, org.orgId, `k/${id}`, org.userId],
  );
  return id;
}

beforeAll(async () => {
  await migrateTestDb();
  url = appUrl();
  A = await seedOrg('a');
  B = await seedOrg('b');
});

describe('cross-organization foreign keys', () => {
  it('rejects a machine that points at another organization branch (composite FK)', async () => {
    const result = await inTenant(url, A.orgId, async (c) => {
      const modelId = randomUUID();
      await c.query(`INSERT INTO machine_models (id, org_id, make, model, category) VALUES ($1, $2, $3, 'M', 'Boom')`, [
        modelId,
        A.orgId,
        `Make-${uid()}`,
      ]);
      return modelId;
    });
    const r = await attempt(
      url,
      A.orgId,
      `INSERT INTO machines (org_id, branch_id, model_id, asset_no, fleet_no, serial_no, current_location)
       VALUES ($1, $2, $3, $4, $5, $6, 'Yard')`,
      [A.orgId, B.branchId, result, `AS-${uid()}`, `FL-${uid()}`, `SN-${uid()}`],
    );
    expect(r).toMatchObject({ ok: false, code: '23503', constraint: 'fk_machines_branch' });
  });

  it('rejects a booking that references another organization machine', async () => {
    const machineB = await inTenant(url, B.orgId, (c) => insertMachine(c, B));
    const customerA = await inTenant(url, A.orgId, (c) => insertCustomer(c, A));
    const r = await inTenant(url, A.orgId, (c) =>
      insertBooking(c, A, machineB, customerA, '2026-02-01', '2026-02-05', 'Draft'),
    ).catch((e: { code?: string; constraint?: string }) => e);
    expect(r).toMatchObject({ code: '23503', constraint: 'fk_bookings_machine' });
  });
});

describe('booking overlap exclusion', () => {
  it('rejects overlapping planned bookings of one machine and allows adjacent ones', async () => {
    const { machineId, customerId } = await inTenant(url, A.orgId, async (c) => ({
      machineId: await insertMachine(c, A),
      customerId: await insertCustomer(c, A),
    }));
    await inTenant(url, A.orgId, (c) => insertBooking(c, A, machineId, customerId, '2026-05-01', '2026-05-10', 'Reserved'));

    const overlap = await inTenant(url, A.orgId, (c) =>
      insertBooking(c, A, machineId, customerId, '2026-05-10', '2026-05-12', 'Approved'),
    ).catch((e: { code?: string; constraint?: string }) => e);
    expect(overlap).toMatchObject({ code: '23P01', constraint: 'ex_machine_planned_booking' });

    // Inclusive dates: the day after the end is free. Draft bookings never reserve the machine.
    await inTenant(url, A.orgId, (c) => insertBooking(c, A, machineId, customerId, '2026-05-11', '2026-05-12', 'Approved'));
    await inTenant(url, A.orgId, (c) => insertBooking(c, A, machineId, customerId, '2026-05-01', '2026-05-30', 'Draft'));
  });

  it('rejects overlapping physical occupancy, including an open-ended On Hire interval', async () => {
    const { machineId, customerId, agreementId } = await inTenant(url, A.orgId, async (c) => {
      const customer = await insertCustomer(c, A);
      const quotation = await insertQuotation(c, A, customer);
      return {
        machineId: await insertMachine(c, A),
        customerId: customer,
        agreementId: await insertAgreement(c, A, quotation, customer),
      };
    });
    const first = randomUUID();
    await inTenant(url, A.orgId, (c) =>
      c.query(
        `INSERT INTO bookings (id, org_id, reference, branch_id, machine_id, customer_id, hire_agreement_id, start_date,
           end_date, status, delivery_address, contact_phone, departed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, '2026-06-01', '2026-06-05', 'On Hire', 'Site', '+971', '2026-06-01T08:00:00Z')`,
        [first, A.orgId, `BK-${uid()}`, A.branchId, machineId, customerId, agreementId],
      ),
    );
    const r = await inTenant(url, A.orgId, (c) =>
      insertBooking(c, A, machineId, customerId, '2026-07-01', '2026-07-02', 'Returned', {
        departed: '2026-06-20T08:00:00Z',
        returned: '2026-06-21T08:00:00Z',
      }),
    ).catch((e: { code?: string; constraint?: string }) => e);
    expect(r).toMatchObject({ code: '23P01', constraint: 'ex_machine_physical_booking' });
  });

  it('rejects On Hire without an agreement and a return before departure', async () => {
    const { machineId, customerId } = await inTenant(url, A.orgId, async (c) => ({
      machineId: await insertMachine(c, A),
      customerId: await insertCustomer(c, A),
    }));
    const noAgreement = await inTenant(url, A.orgId, (c) =>
      insertBooking(c, A, machineId, customerId, '2026-08-01', '2026-08-02', 'On Hire'),
    ).catch((e: { constraint?: string }) => e);
    expect(noAgreement).toMatchObject({ constraint: 'ck_bookings_on_hire_chain' });
    const badReturn = await inTenant(url, A.orgId, (c) =>
      insertBooking(c, A, machineId, customerId, '2026-08-01', '2026-08-02', 'Returned', {
        departed: '2026-08-02T00:00:00Z',
        returned: '2026-08-01T00:00:00Z',
      }),
    ).catch((e: { constraint?: string }) => e);
    expect(badReturn).toMatchObject({ constraint: 'ck_actual_booking_return' });
  });
});

describe('hire agreements', () => {
  it('rejects a second non-cancelled agreement for one quotation, but allows one after cancellation', async () => {
    const { quotation, customer } = await inTenant(url, A.orgId, async (c) => {
      const customerId = await insertCustomer(c, A);
      return { customer: customerId, quotation: await insertQuotation(c, A, customerId) };
    });
    const first = await inTenant(url, A.orgId, (c) => insertAgreement(c, A, quotation, customer));
    const second = await inTenant(url, A.orgId, (c) => insertAgreement(c, A, quotation, customer)).catch(
      (e: { code?: string; constraint?: string }) => e,
    );
    expect(second).toMatchObject({ code: '23505', constraint: 'uq_live_quote_agreement' });

    await inTenant(url, A.orgId, (c) => c.query(`UPDATE hire_agreements SET status = 'Cancelled' WHERE id = $1`, [first]));
    await inTenant(url, A.orgId, (c) => insertAgreement(c, A, quotation, customer));
  });

  it('rejects an agreement whose customer differs from the quotation customer', async () => {
    const r = await inTenant(url, A.orgId, async (c) => {
      const quoteCustomer = await insertCustomer(c, A);
      const otherCustomer = await insertCustomer(c, A);
      const quotation = await insertQuotation(c, A, quoteCustomer);
      return insertAgreement(c, A, quotation, otherCustomer);
    }).catch((e: { code?: string; constraint?: string }) => e);
    expect(r).toMatchObject({ code: '23503', constraint: 'fk_hire_agreements_quotation_customer' });
  });

  it('rejects an LPO whose customer differs from the quotation customer', async () => {
    const r = await inTenant(url, A.orgId, async (c) => {
      const quoteCustomer = await insertCustomer(c, A);
      const otherCustomer = await insertCustomer(c, A);
      const quotation = await insertQuotation(c, A, quoteCustomer);
      await c.query(
        `INSERT INTO customer_lpos (org_id, quotation_id, customer_id, lpo_no, received_on, currency_code)
         VALUES ($1, $2, $3, 'LPO-1', '2026-01-01', 'AED')`,
        [A.orgId, quotation, otherCustomer],
      );
    }).catch((e: { code?: string; constraint?: string }) => e);
    expect(r).toMatchObject({ code: '23503', constraint: 'fk_customer_lpos_quotation_customer' });
  });
});

describe('invoices', () => {
  async function invoiceInsert(c: pg.Client, q: string, ha: string, cust: string, seq: number, start: string, end: string) {
    await c.query(
      `INSERT INTO invoices (org_id, quotation_id, hire_agreement_id, customer_id, invoice_no, quotation_no_snapshot,
         agreement_no_snapshot, sequence_no, invoice_type, period_start, period_end, invoice_date, due_date, currency_code,
         issuer_snapshot, customer_snapshot, hire_period_text, delivery_location, payment_terms, payment_term_days,
         payment_method, subtotal, vat_rate, vat_amount, total_amount, amount_due)
       VALUES ($1, $2, $3, $4, $5, 'Q', 'HA', $6, 'Continuous Hire', $7, $8, '2026-02-01', '2026-03-03', 'AED',
         '{}', '{}', 'text', 'Site', 'Net 30', 30, 'Transfer', 100, 0.05, 5, 105, 105)`,
      [A.orgId, q, ha, cust, `INV-${uid()}`, seq, start, end],
    );
  }

  it('requires a Won quotation and rejects overlapping non-cancelled periods', async () => {
    const { q, ha, cust } = await inTenant(url, A.orgId, async (c) => {
      const customer = await insertCustomer(c, A);
      const quotation = await insertQuotation(c, A, customer);
      return { q: quotation, cust: customer, ha: await insertAgreement(c, A, quotation, customer) };
    });
    const notWon = await inTenant(url, A.orgId, (c) => invoiceInsert(c, q, ha, cust, 1, '2026-01-01', '2026-01-31')).catch(
      (e: { message?: string }) => e,
    );
    expect(notWon).toMatchObject({ message: expect.stringContaining('NOT_WON') });

    await inTenant(url, A.orgId, (c) => c.query(`UPDATE quotations SET phase = 'WON', won_at = now() WHERE id = $1`, [q]));
    await inTenant(url, A.orgId, (c) => invoiceInsert(c, q, ha, cust, 1, '2026-01-01', '2026-01-31'));
    const overlap = await inTenant(url, A.orgId, (c) => invoiceInsert(c, q, ha, cust, 2, '2026-01-31', '2026-02-28')).catch(
      (e: { code?: string; constraint?: string }) => e,
    );
    expect(overlap).toMatchObject({ code: '23P01', constraint: 'ex_quote_invoice_overlap' });
    await inTenant(url, A.orgId, (c) => invoiceInsert(c, q, ha, cust, 2, '2026-02-01', '2026-02-28'));
  });
});

describe('exactly one owner', () => {
  it('requires exactly one owner foreign key on documents', async () => {
    const { quotation, agreement } = await inTenant(url, A.orgId, async (c) => {
      const customer = await insertCustomer(c, A);
      const q = await insertQuotation(c, A, customer);
      return { quotation: q, agreement: await insertAgreement(c, A, q, customer) };
    });
    const insertDoc = (qid: string | null, hid: string | null) =>
      attempt(
        url,
        A.orgId,
        `INSERT INTO documents (org_id, document_type, document_no, quotation_id, hire_agreement_id)
         VALUES ($1, 'QUOTATION', 'DOC-1', $2, $3)`,
        [A.orgId, qid, hid],
      );
    expect(await insertDoc(null, null)).toMatchObject({ ok: false, constraint: 'ck_documents_one_owner' });
    expect(await insertDoc(quotation, agreement)).toMatchObject({ ok: false, constraint: 'ck_documents_one_owner' });
    expect(await insertDoc(quotation, null)).toMatchObject({ ok: true });
    // The owner must also be the one that fits the document type.
    const wrongOwner = await attempt(
      url,
      A.orgId,
      `INSERT INTO documents (org_id, document_type, document_no, hire_agreement_id) VALUES ($1, 'QUOTATION', 'DOC-2', $2)`,
      [A.orgId, agreement],
    );
    expect(wrongOwner).toMatchObject({ ok: false, constraint: 'ck_documents_owner_matches_type' });
  });

  it('requires exactly one owner foreign key on evidence_attachments', async () => {
    const { file, pass } = await inTenant(url, A.orgId, async (c) => {
      const machine = await insertMachine(c, A);
      const passId = randomUUID();
      await c.query(
        `INSERT INTO gate_passes (id, org_id, reference, branch_id, machine_id, direction, movement_purpose, fleet_no_snapshot,
           driver_name, destination, capture_method)
         VALUES ($1, $2, $3, $4, $5, 'OUT', 'TRANSFER', 'FL', 'Driver', 'Dest', 'Manual')`,
        [passId, A.orgId, `GP-${uid()}`, A.branchId, machine],
      );
      return { file: await insertFile(c, A), pass: passId };
    });
    const insertEv = (gate: string | null) =>
      attempt(
        url,
        A.orgId,
        `INSERT INTO evidence_attachments (org_id, file_id, gate_pass_id, photo_role) VALUES ($1, $2, $3, 'truck')`,
        [A.orgId, file, gate],
      );
    expect(await insertEv(null)).toMatchObject({ ok: false, constraint: 'ck_evidence_attachments_one_owner' });
    expect(await insertEv(pass)).toMatchObject({ ok: true });
  });
});

describe('append-only tables', () => {
  it('rejects UPDATE and DELETE on quotation_phase_history, audit_events and gate_movements for fleet_app', async () => {
    const ids = await inTenant(url, A.orgId, async (c) => {
      const customer = await insertCustomer(c, A);
      const quotation = await insertQuotation(c, A, customer);
      const phase = randomUUID();
      await c.query(
        `INSERT INTO quotation_phase_history (id, org_id, quotation_id, to_phase, source, source_key)
         VALUES ($1, $2, $3, 'AWAITING', 'SYSTEM', $4)`,
        [phase, A.orgId, quotation, `sk-${phase}`],
      );
      const audit = randomUUID();
      await c.query(
        `INSERT INTO audit_events (id, org_id, action, entity_type, correlation_id) VALUES ($1, $2, 'x', 'quotation', $3)`,
        [audit, A.orgId, randomUUID()],
      );
      const machine = await insertMachine(c, A);
      const pass = randomUUID();
      await c.query(
        `INSERT INTO gate_passes (id, org_id, reference, branch_id, machine_id, direction, movement_purpose, fleet_no_snapshot,
           driver_name, destination, capture_method)
         VALUES ($1, $2, $3, $4, $5, 'OUT', 'TRANSFER', 'FL', 'Driver', 'Dest', 'Manual')`,
        [pass, A.orgId, `GP-${uid()}`, A.branchId, machine],
      );
      const movement = randomUUID();
      await c.query(
        `INSERT INTO gate_movements (id, org_id, gate_pass_id, machine_id, direction, operator_user_id, capture_method)
         VALUES ($1, $2, $3, $4, 'OUT', $5, 'Manual')`,
        [movement, A.orgId, pass, machine, A.userId],
      );
      return { phase, audit, movement };
    });

    const targets: [string, string, string][] = [
      ['quotation_phase_history', ids.phase, 'reason'],
      ['audit_events', ids.audit, 'reason'],
      ['gate_movements', ids.movement, 'notes'],
    ];
    for (const [table, id, column] of targets) {
      const upd = await attempt(url, A.orgId, `UPDATE ${table} SET ${column} = 'tamper' WHERE id = $1`, [id]);
      expect(upd, `${table} UPDATE`).toMatchObject({ ok: false, code: '42501' });
      const del = await attempt(url, A.orgId, `DELETE FROM ${table} WHERE id = $1`, [id]);
      expect(del, `${table} DELETE`).toMatchObject({ ok: false, code: '42501' });
    }
  });

  it('rejects a gate movement whose booking differs from its pass booking', async () => {
    const r = await inTenant(url, A.orgId, async (c) => {
      const customer = await insertCustomer(c, A);
      const machine = await insertMachine(c, A);
      const booking = await insertBooking(c, A, machine, customer, '2026-09-01', '2026-09-02', 'Reserved');
      const pass = randomUUID();
      await c.query(
        `INSERT INTO gate_passes (id, org_id, reference, branch_id, machine_id, booking_id, direction, movement_purpose,
           fleet_no_snapshot, driver_name, destination, capture_method)
         VALUES ($1, $2, $3, $4, $5, $6, 'IN', 'CUSTOMER_RETURN', 'FL', 'Driver', 'Yard', 'Manual')`,
        [pass, A.orgId, `GP-${uid()}`, A.branchId, machine, booking],
      );
      await c.query(
        `INSERT INTO gate_movements (org_id, gate_pass_id, machine_id, booking_id, direction, operator_user_id, capture_method)
         VALUES ($1, $2, $3, NULL, 'IN', $4, 'Manual')`,
        [A.orgId, pass, machine, A.userId],
      );
    }).catch((e: { code?: string; message?: string }) => e);
    expect(r).toMatchObject({ code: '23514', message: expect.stringContaining('booking') });
  });
});
