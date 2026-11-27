/**
 * App onboarding presets — the AxleOps equivalent of Odoo's "Choose your store"
 * scenarios (point_of_sale/data/scenarios/*).
 *
 * When a company opens a freshly-activated app that has NO data yet, it shows
 * these preset cards. Picking one seeds a starter dataset (or starts blank).
 *
 * BACKEND-READY DESIGN
 * --------------------
 * A preset is pure DATA: `{ id, name, description, records }`. It describes WHAT
 * to create, not HOW. The onboarding service reads this and calls the normal
 * create services. When a real backend arrives, `onboardingService.applyPreset`
 * becomes a single API call (e.g. POST /apps/:appId/presets/:presetId) and these
 * same definitions can live server-side — no UI changes needed.
 */

export interface AppPreset {
  id: string;
  name: string;
  description: string;
  /** emoji/icon hint for the card (kept simple + serializable) */
  icon: string;
  /** 'blank' seeds nothing; otherwise the service seeds `records`. */
  blank?: boolean;
  /** Declarative starter records, keyed by collection name. */
  records?: {
    machines?: Array<Record<string, unknown>>;
    crossHires?: Array<Record<string, unknown>>;
    branches?: Array<Record<string, unknown>>;
  };
}

/** Short "what this creates" preview lines for a preset's card. */
export function presetPreview(p: AppPreset): string[] {
  if (p.blank) return ['Starts empty', 'Add your own records'];
  const r = p.records ?? {};
  const lines: string[] = [];
  if (r.machines?.length) lines.push(`${r.machines.length} machine${r.machines.length > 1 ? 's' : ''}`);
  if (r.crossHires?.length) lines.push(`${r.crossHires.length} cross-hire deal${r.crossHires.length > 1 ? 's' : ''}`);
  if (r.branches?.length) lines.push(`${r.branches.length} branch${r.branches.length > 1 ? 'es' : ''}`);
  return lines.length ? lines : ['Sample starter data'];
}

// Presets per app id. An app with no entry here simply shows no onboarding.
export const APP_PRESETS: Record<string, AppPreset[]> = {
  fleet: [
    {
      id: 'blank',
      name: 'Start blank',
      description: 'Add your own machines from scratch',
      icon: '➕',
      blank: true,
    },
  ],

  cross_hire: [
    {
      id: 'sample',
      name: 'Sample cross hire',
      description: 'A couple of example re-hire deals to explore the module',
      icon: '🔁',
      records: {
        crossHires: [
          { reference: 'CH-0001', category: 'Articulating Boom', make: 'JLG', model: '450AJ', description: '16m Diesel Articulating Boom', supplierName: 'Access Rentals Co', buyRate: 2800, customerName: 'Demo Client', siteLocation: 'City Center', sellRate: 4200, ratePeriod: 'Month', quantity: 1, branchName: 'Head Office', status: 'On Hire', salesRep: 'Owner' },
        ],
      },
    },
    {
      id: 'blank',
      name: 'Start blank',
      description: 'Add your own cross-hire deals from scratch',
      icon: '➕',
      blank: true,
    },
  ],

  branches: [
    {
      id: 'single',
      name: 'Single location',
      description: 'One head office branch to start',
      icon: '📍',
      records: {
        branches: [{ name: 'Head Office', code: 'HO', country: 'UAE', city: '', manager: '' }],
      },
    },
    {
      id: 'blank',
      name: 'Start blank',
      description: 'Add your branches one by one',
      icon: '➕',
      blank: true,
    },
  ],
};

// Apps with no specific presets still get a consistent onboarding: just a
// "Start blank" card. (Their data model has no quick seed yet; the user adds
// records themselves. When those apps gain seedable presets, add them above.)
const GENERIC_BLANK: AppPreset = {
  id: 'blank',
  name: 'Start blank',
  description: 'Begin with an empty workspace and add records as you go',
  icon: '➕',
  blank: true,
};

export function presetsForApp(appId: string): AppPreset[] {
  return APP_PRESETS[appId] ?? [GENERIC_BLANK];
}
