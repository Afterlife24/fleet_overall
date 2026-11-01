/**
 * Geo-coordinates for the Fleet Map.
 *
 * Placement follows OPERATIONAL LOGIC rather than random scatter:
 *   - Machines not on hire (Available, PDI, PHI, workshop, repair, allocated)
 *     sit clustered inside their branch YARD.
 *   - Machines On Hire (or broken down on site) sit at a CUSTOMER SITE, away
 *     from the yard — mirroring the real hire lifecycle (overview §4).
 *   - Machines in Transport sit partway along the yard → site route.
 *   - Transport jobs are placed along their own origin → destination route,
 *     positioned by job status (Scheduled at origin, In Transit midway,
 *     Delivered at destination, etc.).
 *
 * All coordinates are DEMO positions on land — real positions would come from
 * telematics or QR-scan GPS capture in production (overview §4.5, §13.6).
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface PlacedCoord extends LatLng {
  /** Human-readable place label for the detail panel */
  place: string;
  /** True when the asset is sitting in its branch yard */
  atYard: boolean;
}

// ── Branch yards — where machines live when NOT on hire ──────────────────────
export const BRANCH_YARDS: Record<string, LatLng> = {
  'br-dxb': { lat: 25.0000, lng: 55.1800 }, // Dubai Investment Park 2
  'br-auh': { lat: 24.3500, lng: 54.5000 }, // Mussafah Industrial, Abu Dhabi
  'br-taw': { lat: 24.6300, lng: 54.7000 }, // Taweelah
  'br-oil': { lat: 23.9000, lng: 53.7000 }, // Oil & Gas region (Habshan/Bab)
  'br-fuj': { lat: 25.1300, lng: 56.3300 }, // Fujairah industrial area
  'br-ksa': { lat: 24.5700, lng: 46.8300 }, // Riyadh Industrial City 2
};

export const DEFAULT_YARD: LatLng = { lat: 24.4539, lng: 54.3773 };

// Map centre when the view first opens (UAE)
export const DEFAULT_COORD: LatLng = { lat: 24.9000, lng: 55.0000 };

interface Site { name: string; lat: number; lng: number }

// ── Customer sites per branch region — where ON HIRE machines are working ────
export const BRANCH_SITES: Record<string, Site[]> = {
  'br-dxb': [
    { name: 'Dubai Marina Site',      lat: 25.0805, lng: 55.1403 },
    { name: 'Downtown Dubai Site',    lat: 25.1972, lng: 55.2744 },
    { name: 'DIFC Site',              lat: 25.2110, lng: 55.2796 },
    { name: 'Business Bay Site',      lat: 25.1857, lng: 55.2650 },
    { name: 'Jebel Ali Site',         lat: 25.0100, lng: 55.0600 },
    { name: 'Al Quoz Site',           lat: 25.1400, lng: 55.2300 },
    { name: 'Silicon Oasis Site',     lat: 25.1200, lng: 55.3800 },
    { name: 'Sharjah Industrial Site',lat: 25.3100, lng: 55.4400 },
    { name: 'Ajman Site',             lat: 25.4052, lng: 55.5136 },
    { name: 'Deira Site',             lat: 25.2700, lng: 55.3200 },
  ],
  'br-auh': [
    { name: 'AD Corniche Site',       lat: 24.4700, lng: 54.3400 },
    { name: 'Yas Island Site',        lat: 24.4990, lng: 54.6070 },
    { name: 'Al Reem Island Site',    lat: 24.4900, lng: 54.4100 },
    { name: 'Khalifa City Site',      lat: 24.4200, lng: 54.5800 },
    { name: 'Saadiyat Site',          lat: 24.5400, lng: 54.4300 },
    { name: 'Mussafah Site',          lat: 24.3600, lng: 54.5200 },
    { name: 'JiuJitsu Arena',         lat: 24.4160, lng: 54.4460 },
    { name: 'Al Ain Site',            lat: 24.2075, lng: 55.7447 },
  ],
  'br-taw': [
    { name: 'Al Taweelah Site',       lat: 24.6500, lng: 54.7200 },
    { name: 'Khalifa Port Site',      lat: 24.8000, lng: 54.6500 },
    { name: 'Taweelah Power Site',    lat: 24.6100, lng: 54.6700 },
    { name: 'UM LULU Hostel',         lat: 24.4300, lng: 54.6200 },
  ],
  'br-oil': [
    { name: 'Ruwais Site',            lat: 24.1100, lng: 52.7300 },
    { name: 'Habshan Site',           lat: 23.7500, lng: 53.6000 },
    { name: 'Bab Field Site',         lat: 23.9000, lng: 53.8000 },
    { name: 'Asab Field Site',        lat: 23.3000, lng: 54.0000 },
    { name: 'ADNOC Hostel',           lat: 24.0800, lng: 52.7600 },
  ],
  'br-fuj': [
    { name: 'Fujairah Port Site',     lat: 25.1600, lng: 56.3400 },
    { name: 'Fujairah City Site',     lat: 25.1288, lng: 56.3265 },
    { name: 'Dibba Site',             lat: 25.6200, lng: 56.2700 },
    { name: 'Kalba Site',             lat: 25.0600, lng: 56.3500 },
  ],
  'br-ksa': [
    { name: 'Riyadh KAFD Site',       lat: 24.7650, lng: 46.6420 },
    { name: 'Riyadh North Site',      lat: 24.8200, lng: 46.6400 },
    { name: 'Diriyah Site',           lat: 24.7370, lng: 46.5750 },
    { name: 'Riyadh Metro Site',      lat: 24.6900, lng: 46.7200 },
  ],
};

// ── Named locations used by transport jobs (origin / destination strings) ────
export const NAMED_LOCATIONS: Record<string, LatLng> = {
  'DXB Yard': BRANCH_YARDS['br-dxb'],
  'AUH Yard': BRANCH_YARDS['br-auh'],
  'TAW Yard': BRANCH_YARDS['br-taw'],
  'Dubai Marina Site':       { lat: 25.0805, lng: 55.1403 },
  'Downtown Dubai Site':     { lat: 25.1972, lng: 55.2744 },
  'DIFC Site':               { lat: 25.2110, lng: 55.2796 },
  'Abu Dhabi Corniche Site': { lat: 24.4700, lng: 54.3400 },
  'Yas Island Site':         { lat: 24.4990, lng: 54.6070 },
  'Al Reem Island Site':     { lat: 24.4900, lng: 54.4100 },
  'Sharjah Industrial Site': { lat: 25.3100, lng: 55.4400 },
  'Fujairah Port Site':      { lat: 25.1600, lng: 56.3400 },
  'ADNOC Hostel':            { lat: 24.0800, lng: 52.7600 },
  'UM LULU Hostel':          { lat: 24.4300, lng: 54.6200 },
  'JiuJitsu Arena':          { lat: 24.4160, lng: 54.4460 },
  'Al Taweela Site':         { lat: 24.6500, lng: 54.7200 },
  'Mussafah Site':           { lat: 24.3600, lng: 54.5200 },
  'Oil Field Camp':          { lat: 23.9000, lng: 53.7000 },
};

// ── Status groupings ────────────────────────────────────────────────────────
// Machines physically inside the yard
const YARD_STATUSES = new Set([
  'Available', 'Allocated', 'PDI', 'PHI', 'In Workshop', 'Under Repair', 'Offline',
]);
// Machines out with a customer (breakdowns happen on site and stay On Hire — §9.1)
const SITE_STATUSES = new Set(['On Hire', 'Breakdown']);

// ── Deterministic hashing so positions are stable across reloads/builds ─────
function hash32(str: string, salt = 0): number {
  let h = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function unit(str: string, salt = 0): number {
  return hash32(str, salt) / 4294967296;
}

/** Small deterministic offset so co-located assets don't perfectly overlap. */
function jitter(seed: string, spread: number): LatLng {
  return {
    lat: (unit(seed, 11) * 2 - 1) * spread,
    lng: (unit(seed, 23) * 2 - 1) * spread,
  };
}

function pickSite(seed: string, sites: Site[]): Site {
  return sites[hash32(seed, 37) % sites.length];
}

function sitesFor(branchId?: string): Site[] {
  return (branchId && BRANCH_SITES[branchId]) || BRANCH_SITES['br-dxb'];
}

function yardFor(branchId?: string): LatLng {
  return (branchId && BRANCH_YARDS[branchId]) || DEFAULT_YARD;
}

/**
 * Where a machine sits, based on its operational status.
 */
export function coordForMachine(m: { id: string; branchId?: string; status: string }): PlacedCoord {
  const yard = yardFor(m.branchId);
  const sites = sitesFor(m.branchId);

  // Out with a customer
  if (SITE_STATUSES.has(m.status)) {
    const site = pickSite(m.id, sites);
    const j = jitter(m.id, 0.006); // ~600m spread around the site
    return { lat: site.lat + j.lat, lng: site.lng + j.lng, place: site.name, atYard: false };
  }

  // On the road between yard and site
  if (m.status === 'Transport') {
    const site = pickSite(m.id, sites);
    const t = 0.35 + unit(m.id, 5) * 0.3; // 35–65% along the route
    const j = jitter(m.id, 0.004);
    return {
      lat: yard.lat + (site.lat - yard.lat) * t + j.lat,
      lng: yard.lng + (site.lng - yard.lng) * t + j.lng,
      place: `In transit → ${site.name}`,
      atYard: false,
    };
  }

  // In the yard — tight cluster (~350m) so it reads as a yard, not a scatter
  const j = jitter(m.id, 0.0035);
  const label = YARD_STATUSES.has(m.status) ? 'Branch Yard' : 'Branch Yard';
  return { lat: yard.lat + j.lat, lng: yard.lng + j.lng, place: label, atYard: true };
}

/**
 * Where a transport job sits along its own route, based on job status.
 */
export function coordForTransportJob(j: {
  id: string; branchId?: string; origin: string; destination: string; status: string;
}): PlacedCoord {
  const from = NAMED_LOCATIONS[j.origin] ?? yardFor(j.branchId);
  const to = NAMED_LOCATIONS[j.destination] ?? yardFor(j.branchId);

  let t: number;
  switch (j.status) {
    case 'Scheduled':  t = 0; break;                       // still at origin
    case 'Loading':    t = 0.03; break;                    // loading at origin
    case 'In Transit': t = 0.4 + unit(j.id, 7) * 0.25; break; // en route
    case 'Delivered':  t = 1; break;                       // at destination
    case 'Returning':  t = 0.6; break;                     // heading back
    case 'Completed':  t = 0; break;                       // back at origin
    default:           t = 0.5;
  }

  const off = jitter(j.id, 0.003);
  const place =
    t === 0 ? j.origin :
    t === 1 ? j.destination :
    `${j.origin} → ${j.destination}`;

  return {
    lat: from.lat + (to.lat - from.lat) * t + off.lat,
    lng: from.lng + (to.lng - from.lng) * t + off.lng,
    place,
    atYard: t === 0 && /yard/i.test(j.origin),
  };
}
