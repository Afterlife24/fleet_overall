// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { transportService, TransportValidationError } from '@/services/services';
import { useAuthStore } from '@/store/authStore';
import { useTransportStore } from '@/store/transportStore';
import type { TransportJobStatus } from '@/types/transport';
import { formArb } from './transportCore.arbs';

const STATUSES: TransportJobStatus[] = ['Scheduled', 'Loading', 'In Transit', 'Delivered', 'Returning', 'Completed', 'Cancelled'];

async function settle<T>(p: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(1000); // delay() uses setTimeout
  return p;
}

let savedUser: unknown;
const asOrg = (orgId: string) => useAuthStore.setState({ user: { orgId } as never });
const resetStore = () =>
  useTransportStore.setState({ jobs: [], counters: {}, seedMarkers: {}, overrides: {}, legacyImported: true });

beforeEach(() => {
  vi.useFakeTimers();
  savedUser = useAuthStore.getState().user;
  resetStore();
});
afterEach(() => {
  vi.useRealTimers();
  useAuthStore.setState({ user: savedUser as never });
});

// Feature: rental-flow-integration, Property 6: Status change round trip
// **Validates: Requirements 1.14**
describe('Property 6: Status change round trip', () => {
  it('persisted rows: the new status is listed by listNow and listJobs', async () => {
    await fc.assert(
      fc.asyncProperty(formArb, fc.constantFrom(...STATUSES), async (form, status) => {
        resetStore();
        asOrg('org-status-new');
        const created = await transportService.create(form);
        expect(created.status).toBe('Scheduled');
        await transportService.updateStatus(created.id, status);
        const now = transportService.listNow();
        const async = await settle(transportService.listJobs());
        expect(now.find((j) => j.id === created.id)?.status).toBe(status);
        expect(async).toEqual(now);
      }),
      { numRuns: 100 },
    );
  });

  it('mock rows: the new status survives as an override and both lists agree', async () => {
    asOrg('org-ja');
    const mockIds = transportService.listNow().map((j) => j.id);
    expect(mockIds.length).toBeGreaterThan(0);
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...mockIds), fc.constantFrom(...STATUSES), async (id, status) => {
        await transportService.updateStatus(id, status);
        const now = transportService.listNow();
        const async = await settle(transportService.listJobs());
        expect(now.find((j) => j.id === id)?.status).toBe(status);
        expect(async).toEqual(now);
        expect((await settle(transportService.getJob(id)))?.status).toBe(status);
      }),
      { numRuns: 100 },
    );
  });

  it('rejects an unknown job id', async () => {
    asOrg('org-a');
    await expect(transportService.updateStatus('nope', 'Completed')).rejects.toThrow('Transport job not found');
  });
});

describe('transportService.create', () => {
  it('rejects an invalid form without touching the store, with field errors', async () => {
    asOrg('org-a');
    const err = await transportService.create({ plannerName: '' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransportValidationError);
    expect(Object.keys((err as TransportValidationError).errors)).toContain('plannerName');
    expect(useTransportStore.getState().jobs).toHaveLength(0);
    expect(useTransportStore.getState().counters).toEqual({});
  });

  it('does not return another company\'s jobs', async () => {
    const form = fc.sample(formArb, 1)[0];
    asOrg('org-a');
    const mine = await transportService.create(form);
    asOrg('org-b');
    expect(transportService.listNow().some((j) => j.id === mine.id)).toBe(false);
    asOrg('org-a');
    expect(transportService.listNow()[0].id).toBe(mine.id);
    expect(mine.reference).toMatch(/^TJ-\d{4}-0001$/);
  });
});
