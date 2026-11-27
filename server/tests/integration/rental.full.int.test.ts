// T20: the full rental, end to end through the API against fleet_test:
// customer -> quotation -> HA/LPO -> booking -> Gate OUT (On Hire + automatic Won) -> invoice -> collection -> Gate IN -> intake -> release.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Actor, type Harness } from './apiHarness.js';
import { newCustomer, newQuotation } from './crmFixtures.js';
import {
  answerInspection, completePass, gatePassBody, getBooking, getMachine, initiateCollection, newAgreement, newBooking, newMachine, newPass,
  phaseHistory, quotationPhase,
} from './rentalFixtures.js';

let h: Harness;
let office: Actor; // managing-director: planner, invoices, collection
let gate: Actor; // security: Gate OUT / IN
let supervisor: Actor; // approves passes
let checker: Actor; // PHI/PDI checker
let workshop: Actor; // releases the hold

beforeAll(async () => {
  h = await createHarness();
  office = await h.actor('full-office', 'managing-director');
  const user = (roleCode: string) => h.addUser(office, { roleCode, branchId: office.branchId, allBranches: true });
  gate = await user('security');
  supervisor = await user('site-supervisor');
  checker = await user('phi-pdi-checker');
  workshop = await user('workshop-manager');
});
afterAll(async () => {
  await h.close();
});

describe('T20 full rental', () => {
  it('runs customer to intake release with consistent state and audit at every step', async () => {
    // 1. Customer, quotation (Awaiting) and agreement with the sent / received evidence.
    const customer = await newCustomer(h, office, 'Full Rental Co');
    const quotation = await newQuotation(h, office, customer.id, { amount: '9000' });
    expect(quotation.phase).toBe('AWAITING');
    const agreement = await newAgreement(h, office, quotation, { hireStartDate: '2030-03-01', hireEndDate: '2030-05-31', monthlyRental: '3000', transportationCharges: '200' });
    const sent = await h.change(office, 'post', `/hire-agreements/${agreement.id}/sent`, agreement.rowVersion, {});
    expect(sent.status).toBe(200);
    const received = await h.change(office, 'post', `/hire-agreements/${agreement.id}/received`, sent.body.rowVersion, { reason: 'Signed copy in hand' });
    expect(received.status).toBe(200);
    const lpo = await h.create(office, '/customer-lpos', {
      quotationId: quotation.id, customerId: customer.id, hireAgreementId: agreement.id, lpoNo: 'LPO/FULL/1', receivedOn: '2030-02-25',
    });
    expect(lpo.status, JSON.stringify(lpo.body)).toBe(201);

    // 2. Booking in the planner with every evidence gate backed by a saved record.
    const machine = await newMachine(h, office);
    const booking = await newBooking(h, office, machine.id, customer.id, {
      hireAgreementId: agreement.id, lpoId: lpo.body.id, status: 'Allocated', startDate: '2030-03-01', endDate: '2030-05-31',
      quoted: true, haSent: true, haReceived: true, reserved: true, dailyRate: '100',
    });
    expect(booking).toMatchObject({ status: 'Allocated', hireAgreementId: agreement.id, startDate: '2030-03-01', endDate: '2030-05-31' });
    expect(await quotationPhase(h, office, quotation.id)).toBe('AWAITING');

    // 3. Gate OUT for hire: pending pass, supervisor approval, security completes -> On Hire and automatic Won.
    const outPass = await newPass(h, gate, gatePassBody(machine.id, { direction: 'OUT', movementPurpose: 'CUSTOMER_HIRE', bookingId: booking.id }));
    expect(outPass.status, JSON.stringify(outPass.body)).toBe(201);
    expect((await h.change(supervisor, 'post', `/gate-passes/${outPass.body.id}/approve`, outPass.body.rowVersion, {})).status).toBe(200);
    const out = await completePass(h, gate, outPass.body.id);
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(out.body.booking).toMatchObject({ status: 'On Hire', departedAt: out.body.movement.occurredAt });
    expect(await quotationPhase(h, office, quotation.id)).toBe('WON');
    expect(await phaseHistory(h, office, quotation.id)).toMatchObject([{ toPhase: 'AWAITING' }, { fromPhase: 'AWAITING', toPhase: 'WON', source: 'ON_HIRE' }]);
    expect(await getMachine(h, office, machine.id)).toMatchObject({ operationalStatus: 'On Hire' });

    // 4. Invoice for the first period (Won quotation, same agreement); transport charged once.
    const prefill = await h.call(office, 'get', `/quotations/${quotation.id}/invoice-prefill?type=Continuous%20Hire`);
    expect(prefill.status).toBe(200);
    expect(prefill.body).toMatchObject({ periodStart: '2030-03-01', suggestedPeriodEnd: '2030-03-31', transport: { amount: '200.00' } });
    const invoice = await h.create(office, '/invoices', {
      quotationId: quotation.id, hireAgreementId: agreement.id, invoiceType: 'Continuous Hire', periodStart: '2030-03-01', periodEnd: '2030-03-31',
      equipment: { quantity: '1', unitRate: '3000', amount: '3000' }, transport: { amount: '200' }, periodChargeConfirmed: true,
    });
    expect(invoice.status, JSON.stringify(invoice.body)).toBe(201);
    expect(invoice.body).toMatchObject({ invoiceNo: `${quotation.quotationNo}/01`, subtotal: '3200.000000', vatAmount: '160.000000', totalAmount: '3360.000000' });
    const issued = await h.change(office, 'post', `/invoices/${invoice.body.id}/issue`, invoice.body.rowVersion, {});
    expect(issued.body.status).toBe('Sent');

    // 5. Collection with the invoice reference: note, MQD, service report and job; billing is not stopped.
    const collection = await initiateCollection(h, office, booking.id, { relatedInvoiceId: invoice.body.id, collectionAddress: 'Customer yard' });
    expect(collection.status, JSON.stringify(collection.body)).toBe(201);
    const { collectionNote: cn, mqdReport, serviceReport, transportJob } = collection.body;
    expect(cn).toMatchObject({ status: 'Draft', relatedInvoiceId: invoice.body.id });
    expect([mqdReport.phase, serviceReport.phase, transportJob.autoGenerated]).toEqual(['COLLECTION', 'COLLECTION', true]);
    expect(await getBooking(h, office, booking.id)).toMatchObject({ status: 'On Hire', returnedAt: null });
    const next = await h.call(office, 'get', `/quotations/${quotation.id}/invoice-prefill?type=Continuous%20Hire`);
    expect(next.status).toBe(200); // still billable after collection was requested
    expect(next.body.periodStart).toBe('2030-04-01');

    // 6. Gate IN against the exact collection note.
    const inPass = await newPass(h, gate, gatePassBody(machine.id, {
      direction: 'IN', movementPurpose: 'CUSTOMER_RETURN', bookingId: booking.id, collectionNoteId: cn.id, destination: 'Main yard', arrivingFrom: 'Customer yard',
    }));
    expect(inPass.status, JSON.stringify(inPass.body)).toBe(201);
    expect((await h.change(supervisor, 'post', `/gate-passes/${inPass.body.id}/approve`, inPass.body.rowVersion, {})).status).toBe(200);
    const back = await completePass(h, gate, inPass.body.id);
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(back.body.movement.closesMovementId).toBe(out.body.movement.id);
    expect(back.body.booking).toMatchObject({ status: 'Returned', returnedAt: back.body.movement.occurredAt });
    expect((await h.call(office, 'get', `/collection-notes/${cn.id}`)).body.collectionNote).toMatchObject({ status: 'Collected', collectedMovementId: back.body.movement.id });
    expect(await getMachine(h, office, machine.id)).toMatchObject({ operationalStatus: 'Available', readinessStatus: 'INTAKE_PENDING' });

    // 7. Intake: pass the checklist, then release the hold with reason and authority.
    const inspection = back.body.inspection;
    const answered = await answerInspection(h, checker, inspection.id);
    expect(answered.status, JSON.stringify(answered.body)).toBe(200);
    const submitted = await h.change(checker, 'post', `/inspections/${inspection.id}/submit`, answered.body.rowVersion, {});
    expect(submitted.body).toMatchObject({ status: 'Passed', overallResult: 'Pass' });
    expect(await getMachine(h, office, machine.id)).toMatchObject({ readinessStatus: 'INTAKE_PENDING' });
    const released = await h.change(workshop, 'post', `/inspections/${inspection.id}/release-hold`, submitted.body.rowVersion, { reason: 'Passed return intake' });
    expect(released.status, JSON.stringify(released.body)).toBe(200);
    expect(await getMachine(h, office, machine.id)).toMatchObject({ operationalStatus: 'Available', readinessStatus: 'READY' });

    // 8. Final state is the same from another session and the audit trail names the actors.
    expect(await getBooking(h, workshop, booking.id)).toMatchObject({ status: 'Returned', physicallyOccupied: false });
    expect(await quotationPhase(h, office, quotation.id)).toBe('WON');
    const events = async (action: string) => (await h.audit(office, action)).map((e) => e.actor_user_id);
    expect(await events('gate_pass.completed')).toEqual(expect.arrayContaining([gate.userId]));
    expect(await events('booking.hire_started')).toEqual([gate.userId]);
    expect(await events('quotation.won_automatic')).toEqual([gate.userId]);
    expect(await events('invoice.issued')).toEqual([office.userId]);
    expect(await events('collection.initiated')).toEqual([office.userId]);
    expect(await events('inspection.submitted')).toEqual([checker.userId]);
    expect(await events('inspection.hold_released')).toEqual([workshop.userId]);
    expect(await h.sql(office, 'SELECT 1 FROM gate_movements WHERE booking_id = $1', [booking.id])).toHaveLength(2);
  });
});
