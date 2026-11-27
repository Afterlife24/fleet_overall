// Task 12.6: machine models, machines and machine documents against fleet_test with the runtime role (fleet_app, RLS)
// and the real auth middleware.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Actor, type Harness } from './apiHarness.js';
import { inTenant, migratorUrl, type SeededOrg } from './testDb.js';

let h: Harness;
let admin: Actor; // managing-director: machines.read + machines.write
let other: Actor; // another company
let reader: Actor; // finance: machines.read only (same company as admin)
let plain: Actor; // driver: no machine permission (same company as admin)

let seq = 0;
const unique = (): { assetNo: string; fleetNo: string; serialNo: string } => {
  seq += 1;
  return { assetNo: `A-${seq}`, fleetNo: `F-${seq}`, serialNo: `S-${seq}` };
};
const modelBody = (extra: object = {}) => ({ make: 'JLG', model: `600S-${(seq += 1)}`, category: 'Boom Lift', ...extra });
const machineBody = (o: SeededOrg, modelId: string, extra: object = {}) => ({
  branchId: o.branchId, modelId, ...unique(), currentLocation: 'Main yard', ...extra,
});

async function newModel(a: Actor, extra: object = {}) {
  const res = await h.create(a, '/machine-models', modelBody(extra));
  expect(res.status).toBe(201);
  return res.body as { id: string; rowVersion: number };
}
async function newMachine(a: Actor, modelId: string, extra: object = {}) {
  const res = await h.create(a, '/machines', machineBody(a, modelId, extra));
  expect(res.status).toBe(201);
  return res.body as { id: string; rowVersion: number; branchId: string; assetNo: string };
}

/** Inserts a file row directly (as the table owner) in the given state. */
async function insertFile(o: SeededOrg, state: { storage: string; scan: string }): Promise<string> {
  const id = randomUUID();
  const verified = state.storage === 'Verified';
  await h.sql(
    o,
    `INSERT INTO files (id, org_id, object_key, original_name, declared_mime, detected_mime, expected_size, byte_size, sha256,
                        storage_state, scan_status, uploaded_by, uploaded_at, verified_at)
     VALUES ($1, $2, $3, 'doc.pdf', 'application/pdf', $4, 10, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id, o.orgId, `test/${id}`, verified ? 'application/pdf' : null, verified ? 10 : null, verified ? 'a'.repeat(64) : null,
      state.storage, state.scan, o.userId, verified ? new Date() : null, verified ? new Date() : null,
    ],
  );
  return id;
}
const cleanFile = (o: SeededOrg) => insertFile(o, { storage: 'Verified', scan: 'Clean' });

beforeAll(async () => {
  h = await createHarness();
  admin = await h.actor('mach-admin', 'managing-director');
  other = await h.actor('mach-other', 'managing-director');
  reader = await h.addUser(admin, { roleCode: 'finance', branchId: admin.branchId, allBranches: true });
  plain = await h.addUser(admin, { roleCode: 'driver', branchId: admin.branchId, allBranches: true });
});

afterAll(async () => {
  await h.close();
});

describe('machine models', () => {
  it('creates idempotently and rejects a duplicate make and model with field errors (409)', async () => {
    const o = await h.actor('model-create', 'managing-director');
    const body = modelBody({ platformHeightM: 12.5, capacityKg: '230', specifications: { drive: '4x4' } });
    expect((await h.call(o, 'post', '/machine-models').send(body)).status).toBe(422);
    const key = randomUUID();
    const first = await h.create(o, '/machine-models', body, key);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ platformHeightM: '12.500', capacityKg: '230.000', specifications: { drive: '4x4' }, rowVersion: 1 });
    expect((await h.create(o, '/machine-models', body, key)).body.id).toBe(first.body.id);
    expect(await h.sql(o, 'SELECT 1 FROM machine_models')).toHaveLength(1);

    const dup = await h.create(o, '/machine-models', body);
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('DUPLICATE');
    expect(dup.body.fieldErrors).toMatchObject({ make: 'duplicate', model: 'duplicate' });
    expect((await h.create(o, '/machine-models', { ...body, model: 'Other' })).status).toBe(201);
    expect((await h.create(other, '/machine-models', body)).status).toBe(201);
    expect((await h.create(o, '/machine-models', { ...body, model: 'Neg', capacityKg: '-1' })).status).toBe(422);
  });

  it('updates with If-Match, lists with search and pagination', async () => {
    const o = await h.actor('model-update', 'managing-director');
    const a = await newModel(o, { make: 'Genie', model: 'Z-45' });
    await newModel(o, { make: 'Skyjack', model: 'SJ-12' });
    expect((await h.call(o, 'patch', `/machine-models/${a.id}`).send({ category: 'x' })).status).toBe(428);
    const upd = await h.change(o, 'patch', `/machine-models/${a.id}`, 1, { category: 'Articulating', powerSource: 'Diesel' });
    expect(upd.body).toMatchObject({ category: 'Articulating', powerSource: 'Diesel', rowVersion: 2 });
    expect((await h.change(o, 'patch', `/machine-models/${a.id}`, 1, { category: 'Stale' })).status).toBe(409);
    expect((await h.change(o, 'patch', `/machine-models/${a.id}`, 2, { model: 'SJ-12', make: 'Skyjack' })).status).toBe(409);

    const list = await h.call(o, 'get', '/machine-models?pageSize=1&sort=make');
    expect(list.body).toMatchObject({ total: 2, pageSize: 1 });
    expect(list.body.items[0].make).toBe('Genie');
    expect((await h.call(o, 'get', '/machine-models?q=sky')).body.total).toBe(1);
    expect((await h.audit(o, 'machine_model.updated')).length).toBe(1);
  });
});

describe('machines', () => {
  it('creates with required fields, defaults and an audit event; replays idempotently', async () => {
    const o = await h.actor('mach-create', 'managing-director');
    const model = await newModel(o);
    const body = machineBody(o, model.id, { manufactureYear: 2022, hoursOperated: 10.5, nextInspectionOn: '2030-02-28' });
    const noKey = await h.call(o, 'post', '/machines').send(body);
    expect(noKey.status).toBe(422);
    const key = randomUUID();
    const created = await h.create(o, '/machines', body, key);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      operationalStatus: 'Available', readinessStatus: 'READY', active: true, hoursOperated: '10.500', manufactureYear: 2022,
      nextInspectionOn: '2030-02-28', lastInspectionOn: null, rowVersion: 1,
    });
    expect((await h.create(o, '/machines', body, key)).body.id).toBe(created.body.id);
    expect(await h.sql(o, 'SELECT 1 FROM machines')).toHaveLength(1);
    expect((await h.audit(o, 'machine.created')).length).toBe(1);

    for (const missing of ['branchId', 'modelId', 'assetNo', 'fleetNo', 'serialNo', 'currentLocation']) {
      const rest: Record<string, unknown> = { ...machineBody(o, model.id) };
      delete rest[missing];
      const res = await h.create(o, '/machines', rest);
      expect(res.status).toBe(422);
      expect(res.body.fieldErrors[missing]).toBeDefined();
    }
    expect((await h.create(o, '/machines', machineBody(o, randomUUID()))).body.fieldErrors.modelId).toBe('not_found');
    expect((await h.create(o, '/machines', machineBody(o, model.id, { nextPhiOn: '2030-02-31' }))).status).toBe(422);
  });

  it('rejects a duplicate asset, fleet or serial number with a field error naming it (409)', async () => {
    const o = await h.actor('mach-dups', 'managing-director');
    const model = await newModel(o);
    const first = machineBody(o, model.id);
    expect((await h.create(o, '/machines', first)).status).toBe(201);
    for (const field of ['assetNo', 'fleetNo', 'serialNo'] as const) {
      const res = await h.create(o, '/machines', { ...machineBody(o, model.id), [field]: first[field] });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('DUPLICATE');
      expect(res.body.fieldErrors[field]).toBe('duplicate');
    }
    // Updating onto an existing number is rejected the same way.
    const second = await newMachine(o, model.id);
    const upd = await h.change(o, 'patch', `/machines/${second.id}`, 1, { serialNo: first.serialNo });
    expect(upd.status).toBe(409);
    expect(upd.body.fieldErrors.serialNo).toBe('duplicate');
    // Another company may use the same numbers.
    const otherModel = await newModel(other);
    expect((await h.create(other, '/machines', { ...first, branchId: other.branchId, modelId: otherModel.id })).status).toBe(201);
  });

  it('accepts only the listed status values', async () => {
    const o = await h.actor('mach-enums', 'managing-director');
    const model = await newModel(o);
    for (const status of ['Available', 'Under Repair', 'In Workshop', 'PDI', 'PHI', 'Breakdown', 'Offline']) {
      expect((await h.create(o, '/machines', machineBody(o, model.id, { operationalStatus: status }))).status).toBe(201);
    }
    for (const readiness of ['READY', 'INTAKE_PENDING', 'BLOCKED']) {
      expect((await h.create(o, '/machines', machineBody(o, model.id, { readinessStatus: readiness }))).status).toBe(201);
    }
    for (const bad of [{ operationalStatus: 'Parked' }, { operationalStatus: 'available' }, { readinessStatus: 'ready' }, { readinessStatus: 'MAYBE' }]) {
      expect((await h.create(o, '/machines', machineBody(o, model.id, bad))).status).toBe(422);
    }
    const m = await newMachine(o, model.id);
    expect((await h.change(o, 'patch', `/machines/${m.id}`, 1, { readinessStatus: 'BLOCKED', operationalStatus: 'Breakdown' })).status).toBe(200);
    expect((await h.change(o, 'patch', `/machines/${m.id}`, 2, { operationalStatus: 'Parked' })).status).toBe(422);
  });

  it('sets Allocated, On Hire and Transport only through the audited manual action with a reason', async () => {
    const o = await h.actor('mach-reserved', 'managing-director');
    const model = await newModel(o);
    for (const status of ['Allocated', 'On Hire', 'Transport']) {
      const create = await h.create(o, '/machines', machineBody(o, model.id, { operationalStatus: status }));
      expect(create.status).toBe(422);
      expect(create.body.fieldErrors.operationalStatus).toBe('reserved_requires_manual_action');
    }
    const m = await newMachine(o, model.id);
    const direct = await h.change(o, 'patch', `/machines/${m.id}`, 1, { operationalStatus: 'On Hire' });
    expect(direct.status).toBe(422);
    expect(direct.body.fieldErrors.operationalStatus).toBe('reserved_requires_manual_action');
    expect((await h.call(o, 'get', `/machines/${m.id}`)).body.operationalStatus).toBe('Available');

    // The manual action needs a reason, If-Match and a known status.
    const url = `/machines/${m.id}/operational-status`;
    expect((await h.call(o, 'post', url).send({ operationalStatus: 'On Hire', reason: 'x' })).status).toBe(428);
    expect((await h.change(o, 'post', url, 1, { operationalStatus: 'On Hire' })).status).toBe(422);
    expect((await h.change(o, 'post', url, 1, { operationalStatus: 'On Hire', reason: '   ' })).status).toBe(422);
    expect((await h.change(o, 'post', url, 1, { operationalStatus: 'Parked', reason: 'x' })).status).toBe(422);
    expect(await h.audit(o, 'machine.operational_status_manual')).toHaveLength(0);

    const ok = await h.change(o, 'post', url, 1, { operationalStatus: 'On Hire', reason: 'Hand-over recorded on paper' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ operationalStatus: 'On Hire', rowVersion: 2 });
    const events = await h.audit(o, 'machine.operational_status_manual');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      reason: 'Hand-over recorded on paper', before_data: { operationalStatus: 'Available' }, after_data: { operationalStatus: 'On Hire' },
    });
    expect(events[0].actor_user_id).toBe(o.userId);
    expect((await h.change(o, 'post', url, 1, { operationalStatus: 'Transport', reason: 'stale' })).status).toBe(409);

    // A form round trip that leaves the reserved status unchanged is not a status edit.
    expect((await h.change(o, 'patch', `/machines/${m.id}`, 2, { operationalStatus: 'On Hire', currentLocation: 'Site 9' })).status).toBe(200);
  });

  it('does not copy model defaults over machine characteristics, now or after the model changes', async () => {
    const o = await h.actor('mach-defaults', 'managing-director');
    const model = await newModel(o, { powerSource: 'Diesel', platformHeightM: '12', capacityKg: '230' });
    const inherits = await newMachine(o, model.id);
    const detail = (await h.call(o, 'get', `/machines/${inherits.id}`)).body;
    expect(detail).toMatchObject({ powerSource: 'Diesel', platformHeightM: '12.000', capacityKg: '230.000' });
    const own = await newMachine(o, model.id, { powerSource: 'Electric', platformHeightM: '14.2', capacityKg: null });
    const ownDetail = (await h.call(o, 'get', `/machines/${own.id}`)).body;
    expect(ownDetail).toMatchObject({ powerSource: 'Electric', platformHeightM: '14.200', capacityKg: null });

    await h.change(o, 'patch', `/machine-models/${model.id}`, 1, { powerSource: 'Hybrid', platformHeightM: '99', capacityKg: '500' });
    for (const [id, expected] of [[inherits.id, detail], [own.id, ownDetail]] as const) {
      const now = (await h.call(o, 'get', `/machines/${id}`)).body;
      expect(now).toMatchObject({ powerSource: expected.powerSource, platformHeightM: expected.platformHeightM, capacityKg: expected.capacityKg });
    }
    // Pointing a machine at another model keeps what was saved on the machine.
    const model2 = await newModel(o, { powerSource: 'Gas' });
    const moved = await h.change(o, 'patch', `/machines/${own.id}`, 1, { modelId: model2.id });
    expect(moved.body).toMatchObject({ modelId: model2.id, powerSource: 'Electric', platformHeightM: '14.200' });
  });

  it('validates custom_attributes against the active machine field definitions', async () => {
    const o = await h.actor('mach-attrs', 'managing-director');
    await h.sql(
      o,
      `INSERT INTO custom_field_definitions (org_id, app_code, entity_type, field_key, label, field_type, options, required)
       VALUES ($1, 'fleet', 'machine', 'colour', 'Colour', 'SELECT', '["Orange","Blue"]', false)`,
      [o.orgId],
    );
    const model = await newModel(o);
    const ok = await newMachine(o, model.id, { customAttributes: { colour: 'Orange' } });
    expect((await h.call(o, 'get', `/machines/${ok.id}`)).body.customAttributes).toEqual({ colour: 'Orange' });
    for (const attrs of [{ colour: 'Pink' }, { weight: 1 }]) {
      const res = await h.create(o, '/machines', machineBody(o, model.id, { customAttributes: attrs }));
      expect(res.status).toBe(422);
      expect(Object.keys(res.body.fieldErrors)[0]).toMatch(/^customAttributes\./);
    }
    expect((await h.change(o, 'patch', `/machines/${ok.id}`, 1, { customAttributes: { colour: 'Blue' } })).status).toBe(200);
    expect((await h.change(o, 'patch', `/machines/${ok.id}`, 2, { customAttributes: { colour: 'Red' } })).status).toBe(422);
  });

  it('archives instead of deleting, including a machine that has documents; archived machines can be filtered', async () => {
    const o = await h.actor('mach-archive', 'managing-director');
    const model = await newModel(o);
    const m = await newMachine(o, model.id);
    const file = await cleanFile(o);
    expect((await h.create(o, `/machines/${m.id}/documents`, { fileId: file, name: 'Reg', documentType: 'Registration' })).status).toBe(201);
    await expect(
      inTenant(migratorUrl(), o.orgId, (c) => c.query('DELETE FROM machines WHERE id = $1', [m.id])),
    ).rejects.toMatchObject({ code: '23503' });

    expect((await h.call(o, 'delete', `/machines/${m.id}`)).status).toBe(428);
    const archived = await h.change(o, 'delete', `/machines/${m.id}`, 1);
    expect(archived.status).toBe(200);
    expect(archived.body).toMatchObject({ active: false, rowVersion: 2 });
    expect(await h.sql(o, 'SELECT 1 FROM machines WHERE id = $1 AND NOT active', [m.id])).toHaveLength(1);
    expect((await h.audit(o, 'machine.archived')).length).toBe(1);
    expect((await h.call(o, 'get', '/machines?active=false')).body.items.map((x: { id: string }) => x.id)).toEqual([m.id]);
    expect((await h.call(o, 'get', '/machines?active=true')).body.items).toHaveLength(0);
    // PATCH cannot reactivate; `active` is not a patchable field.
    expect((await h.change(o, 'patch', `/machines/${m.id}`, 2, { active: true })).status).toBe(422);
  });

  it('filters by branch, status, readiness and model, searches numbers literally and paginates', async () => {
    const o = await h.actor('mach-list', 'managing-director');
    const branch2 = await h.addBranch(o, 'B2');
    const m1 = await newModel(o);
    const m2 = await newModel(o);
    const a = await newMachine(o, m1.id, { assetNo: 'AAA-1' });
    const b = await newMachine(o, m1.id, { assetNo: 'BBB_2', branchId: branch2, operationalStatus: 'PHI' });
    const c = await newMachine(o, m2.id, { assetNo: 'CCC-3', readinessStatus: 'BLOCKED' });
    const ids = async (qs: string) =>
      ((await h.call(o, 'get', `/machines${qs}`)).body.items as { id: string }[]).map((x) => x.id);

    expect(await ids('?sort=assetNo')).toEqual([a.id, b.id, c.id]);
    expect(await ids(`?branchId=${branch2}`)).toEqual([b.id]);
    expect(await ids('?status=PHI')).toEqual([b.id]);
    expect(await ids('?readiness=BLOCKED')).toEqual([c.id]);
    expect(await ids(`?modelId=${m2.id}`)).toEqual([c.id]);
    expect(await ids('?q=bbb_')).toEqual([b.id]);
    expect(await ids('?q=_')).toEqual([b.id]); // literal underscore, not "any character"
    expect(await ids("?q=%27%3B%20DROP%20TABLE%20machines%3B--")).toEqual([]);
    const page = await h.call(o, 'get', '/machines?sort=assetNo&pageSize=2&page=2');
    expect(page.body).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(page.body.items.map((x: { id: string }) => x.id)).toEqual([c.id]);
    for (const bad of ['?status=Parked', '?readiness=x', '?branchId=nope', '?sort=secret']) {
      expect((await h.call(o, 'get', `/machines${bad}`)).status).toBe(422);
    }
  });

  it('hides machines of other branches from a branch-scoped principal', async () => {
    const o = await h.actor('mach-scope', 'managing-director');
    const branch2 = await h.addBranch(o, 'B2');
    const model = await newModel(o);
    const mine = await newMachine(o, model.id);
    const theirs = await newMachine(o, model.id, { branchId: branch2 });
    const scoped = await h.addUser(o, { roleCode: 'operations-manager', branchId: o.branchId, allBranches: false });
    expect((await h.call(scoped, 'get', '/machines')).body.items.map((x: { id: string }) => x.id)).toEqual([mine.id]);
    expect((await h.call(scoped, 'get', `/machines/${mine.id}`)).status).toBe(200);
    expect((await h.call(scoped, 'get', `/machines/${theirs.id}`)).status).toBe(404);
    expect((await h.change(scoped, 'patch', `/machines/${theirs.id}`, 1, { currentLocation: 'x' })).status).toBe(404);
    expect((await h.change(scoped, 'delete', `/machines/${theirs.id}`, 1)).status).toBe(404);
    expect((await h.change(scoped, 'post', `/machines/${theirs.id}/operational-status`, 1, { operationalStatus: 'Offline', reason: 'x' })).status).toBe(404);
    expect((await h.create(scoped, '/machines', machineBody(o, model.id, { branchId: branch2 }))).status).toBe(403);
  });
});

describe('machine documents', () => {
  it('attaches a Verified and Clean file, replays idempotently, lists, filters and deactivates', async () => {
    const o = await h.actor('doc-create', 'managing-director');
    const model = await newModel(o);
    const m = await newMachine(o, model.id);
    const url = `/machines/${m.id}/documents`;
    const file = await cleanFile(o);
    const body = { fileId: file, name: 'Registration 2026', documentType: 'Registration', expiresOn: '2027-01-31' };

    expect((await h.call(o, 'post', url).send(body)).status).toBe(422); // Idempotency-Key required
    const key = randomUUID();
    const created = await h.create(o, url, body, key);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ machineId: m.id, fileId: file, documentType: 'Registration', expiresOn: '2027-01-31', active: true, rowVersion: 1 });
    expect((await h.create(o, url, body, key)).body.id).toBe(created.body.id);
    expect(await h.sql(o, 'SELECT 1 FROM machine_documents')).toHaveLength(1);

    for (const type of ['Insurance', 'Certificate', 'Manual', 'Permit']) {
      expect((await h.create(o, url, { ...body, documentType: type, expiresOn: null })).status).toBe(201);
    }
    for (const bad of [{ documentType: 'Invoice' }, { name: '' }, { fileId: 'nope' }, { expiresOn: '2027-02-30' }, { machineId: m.id }]) {
      expect((await h.create(o, url, { ...body, ...bad })).status).toBe(422);
    }

    const all = await h.call(o, 'get', url);
    expect(all.body.items).toHaveLength(5);
    expect((await h.call(o, 'get', `${url}?documentType=Permit`)).body.items).toHaveLength(1);
    expect((await h.call(o, 'get', `${url}/${created.body.id}`)).body.name).toBe('Registration 2026');

    expect((await h.call(o, 'delete', `${url}/${created.body.id}`)).status).toBe(428);
    const off = await h.change(o, 'delete', `${url}/${created.body.id}`, 1);
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ active: false, rowVersion: 2 });
    expect((await h.change(o, 'delete', `${url}/${created.body.id}`, 1)).status).toBe(409);
    expect((await h.call(o, 'get', `${url}?active=false`)).body.items.map((d: { id: string }) => d.id)).toEqual([created.body.id]);
    expect(await h.sql(o, 'SELECT 1 FROM machine_documents WHERE id = $1', [created.body.id])).toHaveLength(1);
    expect((await h.audit(o, 'machine_document.created')).length).toBe(5);
    expect((await h.audit(o, 'machine_document.deactivated')).length).toBe(1);
  });

  it('rejects a file that is not Verified and Clean with 422 FILE_INVALID and another company\'s file with 404', async () => {
    const o = await h.actor('doc-files', 'managing-director');
    const model = await newModel(o);
    const m = await newMachine(o, model.id);
    const url = `/machines/${m.id}/documents`;
    const bad = [
      await insertFile(o, { storage: 'Pending', scan: 'Pending' }),
      await insertFile(o, { storage: 'Verified', scan: 'Pending' }),
      await insertFile(o, { storage: 'Verified', scan: 'Rejected' }),
      await insertFile(o, { storage: 'Verified', scan: 'Failed' }),
      await insertFile(o, { storage: 'Failed', scan: 'Failed' }),
    ];
    for (const fileId of bad) {
      const res = await h.create(o, url, { fileId, name: 'Doc', documentType: 'Manual' });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('FILE_INVALID');
    }
    expect((await h.create(o, url, { fileId: randomUUID(), name: 'Doc', documentType: 'Manual' })).status).toBe(404);
    const foreign = await cleanFile(other);
    expect((await h.create(o, url, { fileId: foreign, name: 'Doc', documentType: 'Manual' })).status).toBe(404);
    expect(await h.sql(o, 'SELECT 1 FROM machine_documents')).toHaveLength(0);
  });

  it('authorizes through the owning machine: a branch-scoped principal cannot read, list or attach to another branch', async () => {
    const o = await h.actor('doc-scope', 'managing-director');
    const branch2 = await h.addBranch(o, 'B2');
    const model = await newModel(o);
    const mine = await newMachine(o, model.id);
    const theirs = await newMachine(o, model.id, { branchId: branch2 });
    const file = await cleanFile(o);
    const mineDoc = (await h.create(o, `/machines/${mine.id}/documents`, { fileId: file, name: 'Mine', documentType: 'Manual' })).body;
    const theirDoc = (await h.create(o, `/machines/${theirs.id}/documents`, { fileId: file, name: 'Theirs', documentType: 'Manual' })).body;
    const scoped = await h.addUser(o, { roleCode: 'operations-manager', branchId: o.branchId, allBranches: false });

    expect((await h.call(scoped, 'get', `/machines/${mine.id}/documents`)).body.items.map((d: { id: string }) => d.id)).toEqual([mineDoc.id]);
    expect((await h.call(scoped, 'get', `/machines/${mine.id}/documents/${mineDoc.id}`)).status).toBe(200);
    expect((await h.call(scoped, 'get', `/machines/${theirs.id}/documents`)).status).toBe(404);
    expect((await h.call(scoped, 'get', `/machines/${theirs.id}/documents/${theirDoc.id}`)).status).toBe(404);
    expect((await h.create(scoped, `/machines/${theirs.id}/documents`, { fileId: file, name: 'x', documentType: 'Manual' })).status).toBe(404);
    expect((await h.change(scoped, 'delete', `/machines/${theirs.id}/documents/${theirDoc.id}`, 1)).status).toBe(404);
    // A document id under the wrong machine does not resolve either.
    expect((await h.call(o, 'get', `/machines/${mine.id}/documents/${theirDoc.id}`)).status).toBe(404);
    expect(await h.sql(o, 'SELECT 1 FROM machine_documents WHERE active')).toHaveLength(2);
  });
});

describe('tenant isolation and permissions (T18)', () => {
  it('another company\'s model, machine and document are 404 on read, update and archive and never listed', async () => {
    const theirModel = await newModel(other);
    const theirMachine = await newMachine(other, theirModel.id);
    const file = await cleanFile(other);
    const theirDoc = (await h.create(other, `/machines/${theirMachine.id}/documents`, { fileId: file, name: 'Theirs', documentType: 'Permit' })).body;
    const myModel = await newModel(admin);

    expect((await h.call(admin, 'get', `/machine-models/${theirModel.id}`)).status).toBe(404);
    expect((await h.change(admin, 'patch', `/machine-models/${theirModel.id}`, 1, { category: 'x' })).status).toBe(404);
    expect((await h.call(admin, 'get', `/machines/${theirMachine.id}`)).status).toBe(404);
    expect((await h.change(admin, 'patch', `/machines/${theirMachine.id}`, 1, { currentLocation: 'x' })).status).toBe(404);
    expect((await h.change(admin, 'delete', `/machines/${theirMachine.id}`, 1)).status).toBe(404);
    expect((await h.change(admin, 'post', `/machines/${theirMachine.id}/operational-status`, 1, { operationalStatus: 'Offline', reason: 'x' })).status).toBe(404);
    expect((await h.call(admin, 'get', `/machines/${theirMachine.id}/documents`)).status).toBe(404);
    expect((await h.call(admin, 'get', `/machines/${theirMachine.id}/documents/${theirDoc.id}`)).status).toBe(404);
    expect((await h.change(admin, 'delete', `/machines/${theirMachine.id}/documents/${theirDoc.id}`, 1)).status).toBe(404);
    expect((await h.create(admin, `/machines/${theirMachine.id}/documents`, { fileId: await cleanFile(admin), name: 'x', documentType: 'Manual' })).status).toBe(404);
    expect((await h.call(admin, 'get', '/machines/not-a-uuid')).status).toBe(404);
    // Using another company's model or branch to build a machine fails as "not found".
    const useModel = await h.create(admin, '/machines', machineBody(admin, theirModel.id));
    expect(useModel.status).toBe(422);
    expect(useModel.body.fieldErrors.modelId).toBe('not_found');
    const useBranch = await h.create(admin, '/machines', machineBody(admin, myModel.id, { branchId: other.branchId }));
    expect(useBranch.status).toBe(422);
    expect(useBranch.body.fieldErrors.branchId).toBe('not_found');

    for (const path of ['/machines', `/machines?q=${theirMachine.assetNo}`, `/machines?modelId=${theirModel.id}`, `/machines?branchId=${other.branchId}`, '/machine-models', '/machine-models?q=JLG']) {
      const res = await h.call(admin, 'get', path);
      expect(res.status).toBe(200);
      const ids = (res.body.items as { id: string }[]).map((x) => x.id);
      expect(ids).not.toContain(theirMachine.id);
      expect(ids).not.toContain(theirModel.id);
    }
    // Nothing changed for the owner.
    const own = await h.call(other, 'get', `/machines/${theirMachine.id}`);
    expect(own.body).toMatchObject({ currentLocation: 'Main yard', active: true, operationalStatus: 'Available', rowVersion: 1 });
    expect((await h.call(other, 'get', `/machines/${theirMachine.id}/documents/${theirDoc.id}`)).body.active).toBe(true);
  });

  it('answers 403 for a same-company role without the permission', async () => {
    const model = await newModel(admin);
    const m = await newMachine(admin, model.id);
    const file = await cleanFile(admin);
    const doc = (await h.create(admin, `/machines/${m.id}/documents`, { fileId: file, name: 'Doc', documentType: 'Manual' })).body;
    // finance: machines.read only.
    for (const path of ['/machines', `/machines/${m.id}`, '/machine-models', `/machines/${m.id}/documents`]) {
      expect((await h.call(reader, 'get', path)).status).toBe(200);
    }
    for (const res of [
      await h.create(reader, '/machine-models', modelBody()),
      await h.create(reader, '/machines', machineBody(admin, model.id)),
      await h.change(reader, 'patch', `/machines/${m.id}`, 1, { currentLocation: 'x' }),
      await h.change(reader, 'post', `/machines/${m.id}/operational-status`, 1, { operationalStatus: 'Offline', reason: 'x' }),
      await h.change(reader, 'delete', `/machines/${m.id}`, 1),
      await h.create(reader, `/machines/${m.id}/documents`, { fileId: file, name: 'x', documentType: 'Manual' }),
      await h.change(reader, 'delete', `/machines/${m.id}/documents/${doc.id}`, 1),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    }
    // driver: no machine permission at all.
    for (const res of [
      await h.call(plain, 'get', '/machines'),
      await h.call(plain, 'get', `/machines/${m.id}`),
      await h.call(plain, 'get', `/machines/${m.id}/documents`),
      await h.call(plain, 'get', '/machine-models'),
    ]) {
      expect(res.status).toBe(403);
    }
    expect((await h.call(admin, 'get', `/machines/${m.id}`)).body).toMatchObject({ currentLocation: 'Main yard', active: true });
  });
});
