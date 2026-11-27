import { create } from 'zustand';
import type { JobOverride, JobPatch, TransportJobRecord } from '@/types/transport';
import { issueRef, type RefCounters } from '@/services/refCounterCore';
import { overrideKey } from '@/services/transportCore';

export class TransportRefExhaustedError extends Error {
  constructor() {
    super('No further transport job references are available for this year');
    this.name = 'TransportRefExhaustedError';
  }
}

/**
 * Non-persisted, in-memory copy of the transport jobs read from the API. The API owns the jobs and
 * their references; this copy only lets retained code that still imports the store see them (the Kanban board and the
 * TRIPBASE report now read the API views directly).
 * `useTransportJobViews` in `hooks/api/useTransportApi.ts` replaces it on every refresh.
 */
interface TransportState {
  jobs: TransportJobRecord[];
  counters: RefCounters;
  overrides: Record<string, JobOverride>;
  setJobs: (jobs: TransportJobRecord[]) => void;
  forOrg: (orgId: string) => TransportJobRecord[];
  /** Local only (legacy callers). Throws TransportRefExhaustedError at 9999. */
  issueRef: (orgId: string, year: number) => string;
  add: (r: TransportJobRecord) => TransportJobRecord;
  update: (orgId: string, id: string, patch: JobPatch) => void;
}

export const useTransportStore = create<TransportState>()((set, get) => ({
  jobs: [],
  counters: {},
  overrides: {},
  setJobs: (jobs) => set({ jobs }),
  forOrg: (orgId) => get().jobs.filter((j) => j.orgId === orgId),
  issueRef: (orgId, year) => {
    const r = issueRef(get().counters, orgId, 'TJ', year);
    if (!r.ok) throw new TransportRefExhaustedError();
    set({ counters: r.counters });
    return r.ref;
  },
  add: (r) => {
    set((s) => ({ jobs: [...s.jobs, r] }));
    return r;
  },
  update: (orgId, id, patch) => {
    const now = new Date().toISOString();
    if (get().jobs.some((j) => j.orgId === orgId && j.id === id)) {
      set((s) => ({
        jobs: s.jobs.map((j) => (j.orgId === orgId && j.id === id ? { ...j, ...patch, updatedAt: now } : j)),
      }));
    } else {
      const key = overrideKey(orgId, id);
      const o: JobOverride = {};
      if (patch.status !== undefined) o.status = patch.status;
      if (patch.driverId !== undefined) o.driverId = patch.driverId;
      if (patch.driverName !== undefined) o.driverName = patch.driverName;
      set((s) => ({ overrides: { ...s.overrides, [key]: { ...s.overrides[key], ...o } } }));
    }
  },
}));
