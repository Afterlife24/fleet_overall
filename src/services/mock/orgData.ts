import type {
  Machine, Branch, Customer, Booking, WorkshopJob, Technician, WorkshopBay,
  Driver, Truck, TransportJob, Inspection, Breakdown, JobCard, User,
  AppNotification, GateEntry,
} from '@/types';
import type { CrossHire } from '@/types/crosshire';
import { JA_ORG_ID } from '@/store/orgStore';
import demo from './johnsonArabiaDemo.json';

/**
 * Per-organization data (demo).
 *
 * - Johnson Arabia (JA_ORG_ID) is the built-in demo company. ALL of its data
 *   lives in one static file: johnsonArabiaDemo.json.
 * - Every other (signed-up) company starts COMPLETELY EMPTY — no machines, no
 *   bookings, no branches, nothing. The owner builds everything from scratch,
 *   like a fresh Odoo database.
 *
 * Each non-JA org gets its own mutable, cached arrays so records it creates in
 * a session persist and stay isolated. When a real backend arrives, these
 * getters become API calls scoped by org.
 */

// A single source of truth for the Johnson Arabia demo, loaded from JSON.
interface DemoData {
  branches: Branch[];
  customers: Customer[];
  machines: Machine[];
  bookings: Booking[];
  workshopJobs: WorkshopJob[];
  technicians: Technician[];
  workshopBays: WorkshopBay[];
  drivers: Driver[];
  trucks: Truck[];
  transportJobs: TransportJob[];
  inspections: Inspection[];
  breakdowns: Breakdown[];
  jobCards: JobCard[];
  users: User[];
  notifications: AppNotification[];
  gateEntries: GateEntry[];
  crossHires: CrossHire[];
}

const JA = demo as unknown as DemoData;

type Coll = keyof DemoData;

// Cache of per-org mutable arrays. JA points at the loaded demo arrays (kept
// mutable for in-session edits); any other org starts with a fresh empty array.
const cache: Record<string, unknown[]> = {};

function collectionForOrg<K extends Coll>(orgId: string, name: K): DemoData[K] {
  const key = `${orgId}:${name}`;
  if (!cache[key]) {
    cache[key] = orgId === JA_ORG_ID ? [...(JA[name] as unknown[])] : [];
  }
  return cache[key] as DemoData[K];
}

export const machinesForOrg = (orgId: string) => collectionForOrg(orgId, 'machines');
export const crossHiresForOrg = (orgId: string) => collectionForOrg(orgId, 'crossHires');
export const bookingsForOrg = (orgId: string) => collectionForOrg(orgId, 'bookings');
export const workshopJobsForOrg = (orgId: string) => collectionForOrg(orgId, 'workshopJobs');
export const transportJobsForOrg = (orgId: string) => collectionForOrg(orgId, 'transportJobs');
export const inspectionsForOrg = (orgId: string) => collectionForOrg(orgId, 'inspections');
export const breakdownsForOrg = (orgId: string) => collectionForOrg(orgId, 'breakdowns');
export const jobCardsForOrg = (orgId: string) => collectionForOrg(orgId, 'jobCards');
export const gateEntriesForOrg = (orgId: string) => collectionForOrg(orgId, 'gateEntries');
export const customersForOrg = (orgId: string) => collectionForOrg(orgId, 'customers');
export const techniciansForOrg = (orgId: string) => collectionForOrg(orgId, 'technicians');
export const workshopBaysForOrg = (orgId: string) => collectionForOrg(orgId, 'workshopBays');
export const driversForOrg = (orgId: string) => collectionForOrg(orgId, 'drivers');
export const trucksForOrg = (orgId: string) => collectionForOrg(orgId, 'trucks');
export const usersForOrg = (orgId: string) => collectionForOrg(orgId, 'users');
export const notificationsForOrg = (orgId: string) => collectionForOrg(orgId, 'notifications');

// Branches: Johnson Arabia has its 6 real branches; a new company has none
// until the owner creates them.
export const branchesForOrg = (orgId: string) => collectionForOrg(orgId, 'branches');
