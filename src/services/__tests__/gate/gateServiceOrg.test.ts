// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gateService } from '@/services/services';
import { useAuthStore } from '@/store/authStore';
import { useGateStore } from '@/store/gateStore';
import type { GateRecord } from '@/types/gate';

const asOrg = (orgId: string | undefined) =>
  useAuthStore.setState({ user: orgId === undefined ? ({} as never) : ({ orgId } as never) });

async function run<T>(p: Promise<T> | T): Promise<T> {
  const result = Promise.resolve(p);
  await vi.advanceTimersByTimeAsync(1000); // delay() uses setTimeout
  return result;
}

const list = () => run(gateService.list()) as Promise<GateRecord[]>;
const create = (data: Record<string, unknown>) =>
  run(gateService.create(data)) as Promise<GateRecord>;

let savedUser: unknown;

beforeEach(() => {
  vi.useFakeTimers();
  savedUser = useAuthStore.getState().user;
  useGateStore.setState({ entries: [], seedMarkers: {}, legacyImported: true });
});
afterEach(() => {
  vi.useRealTimers();
  useAuthStore.setState({ user: savedUser as never });
});

describe('gateService with several companies', () => {
  it('list for one company never returns rows of another', async () => {
    asOrg('org-x');
    const a = await create({ id: 'ge-a', reference: 'GP-A' });
    asOrg('org-y');
    const b = await create({ id: 'ge-b', reference: 'GP-B' });
    expect((await list()).map((r) => r.id)).toEqual([b.id]);
    asOrg('org-x');
    expect((await list()).map((r) => r.id)).toEqual([a.id]);
    asOrg('org-ja');
    expect((await list()).every((r) => r.orgId === 'org-ja')).toBe(true);
  });

  it('create stores the current company and ignores an orgId in the payload', async () => {
    asOrg('org-x');
    const out = await create({ id: 'ge-1', reference: 'GP-1', orgId: 'org-other' });
    expect(out.orgId).toBe('org-x');
    expect(useGateStore.getState().entries.find((r) => r.id === 'ge-1')?.orgId).toBe('org-x');
  });

  it('create fills driver and destination defaults and forces Pending', async () => {
    asOrg('org-x');
    const out = await create({ arrivingFrom: 'Dubai', status: 'Completed' });
    expect(out).toMatchObject({ driver: '', destination: 'Dubai', status: 'Pending' });
    expect(out.id).toBeTruthy();
    expect(out.reference).toBeTruthy();
  });

  it('a user without orgId is treated as org-ja', async () => {
    asOrg(undefined);
    const out = await create({ id: 'ge-ja', reference: 'GP-JA' });
    expect(out.orgId).toBe('org-ja');
  });

  it('a company other than org-ja can create, approve and complete', async () => {
    asOrg('org-x');
    await create({ id: 'ge-1', reference: 'GP-1' });
    expect(((await run(gateService.approve('ge-1'))) as GateRecord).status).toBe('Approved');
    expect(((await run(gateService.complete('ge-1'))) as GateRecord).status).toBe('Completed');
    const rows = await list();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('Completed');
  });

  it('approve of an unknown id, or of another company\'s record, throws', async () => {
    asOrg('org-x');
    await create({ id: 'ge-1', reference: 'GP-1' });
    expect(() => gateService.approve('missing')).toThrow('Gate entry not found');
    asOrg('org-y');
    expect(() => gateService.approve('ge-1')).toThrow('Gate entry not found');
  });
});
