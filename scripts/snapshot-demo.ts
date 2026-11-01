/**
 * One-time snapshot: freeze all Johnson Arabia demo data into a single JSON file.
 *
 * The mock data is normally generated at runtime (random TPC dates, timelines, etc).
 * This script runs that generation once and writes the result to
 * src/services/mock/johnsonArabiaDemo.json so the app can load the demo org's
 * data from one static file. Run with: npx tsx scripts/snapshot-demo.ts
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { branches } from '../src/services/mock/branches';
import { customers } from '../src/services/mock/customers';
import { machines } from '../src/services/mock/machines';
import { bookings } from '../src/services/mock/bookings';
import { workshopJobs, technicians, workshopBays } from '../src/services/mock/workshop';
import { drivers, trucks, transportJobs } from '../src/services/mock/transport';
import { inspections } from '../src/services/mock/inspections';
import { breakdowns } from '../src/services/mock/breakdowns';
import { jobCards } from '../src/services/mock/jobcards';
import { users } from '../src/services/mock/users';
import { notifications } from '../src/services/mock/notifications';
import { gateEntries } from '../src/services/mock/gate';
import { crossHires } from '../src/services/mock/crosshire';

const snapshot = {
  branches,
  customers,
  machines,
  bookings,
  workshopJobs,
  technicians,
  workshopBays,
  drivers,
  trucks,
  transportJobs,
  inspections,
  breakdowns,
  jobCards,
  users,
  notifications,
  gateEntries,
  crossHires,
};

const out = resolve(import.meta.dirname, '../src/services/mock/johnsonArabiaDemo.json');
writeFileSync(out, JSON.stringify(snapshot, null, 2), 'utf8');

const counts = Object.fromEntries(
  Object.entries(snapshot).map(([k, v]) => [k, Array.isArray(v) ? v.length : 1])
);
console.log('Wrote demo snapshot to', out);
console.log('Collection counts:', counts);
