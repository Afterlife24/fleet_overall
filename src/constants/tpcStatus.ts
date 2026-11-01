/**
 * TPC (Third Party Certification) status logic
 *
 * TPC is a mandatory government-approved safety certification for lifting
 * machines under UAE law. JA (as owner) must keep every machine certified.
 * The certificate expires every 6 months and must be renewed before it lapses.
 *
 * Reminder tiers (per business rule):
 *   - > 30 days remaining  → OK        (green)
 *   - 30 days or less      → Reminder  (yellow)   first reminder ~1 month out
 *   - 20 days or less      → Due Soon  (orange)   second reminder
 *   - 10 days or less      → Urgent    (red)      final reminder
 *   - past expiry          → Expired   (red)      stays red until renewed
 */

export type TPCTier = 'ok' | 'reminder' | 'due-soon' | 'urgent' | 'expired' | 'unknown';

export interface TPCStatus {
  tier: TPCTier;
  daysRemaining: number | null; // negative = days since expiry, null = no date
  label: string;
  /** Tailwind text + background classes for badges */
  className: string;
  /** hex color for charts/inline styles */
  color: string;
  /** true when a reminder/alert should be surfaced to ops & workshop */
  needsAttention: boolean;
}

/** Whole-day difference between the expiry date and now (positive = future). */
function daysUntil(dateStr: string): number {
  const expiry = new Date(dateStr);
  const now = new Date();
  // normalise both to midnight so partial days don't skew the count
  expiry.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round((expiry.getTime() - now.getTime()) / msPerDay);
}

export function getTPCStatus(tpcExpiryDate?: string | null): TPCStatus {
  if (!tpcExpiryDate) {
    return {
      tier: 'unknown',
      daysRemaining: null,
      label: 'No TPC on record',
      className: 'text-gray-600 bg-gray-100',
      color: '#6b7280',
      needsAttention: true,
    };
  }

  const days = daysUntil(tpcExpiryDate);

  if (days < 0) {
    return {
      tier: 'expired',
      daysRemaining: days,
      label: `Expired ${Math.abs(days)}d ago`,
      className: 'text-white bg-red-600',
      color: '#dc2626',
      needsAttention: true,
    };
  }

  if (days <= 10) {
    return {
      tier: 'urgent',
      daysRemaining: days,
      label: days === 0 ? 'Expires today' : `${days}d left`,
      className: 'text-white bg-red-500',
      color: '#ef4444',
      needsAttention: true,
    };
  }

  if (days <= 20) {
    return {
      tier: 'due-soon',
      daysRemaining: days,
      label: `${days}d left`,
      className: 'text-white bg-orange-500',
      color: '#f97316',
      needsAttention: true,
    };
  }

  if (days <= 30) {
    return {
      tier: 'reminder',
      daysRemaining: days,
      label: `${days}d left`,
      className: 'text-yellow-900 bg-yellow-300',
      color: '#eab308',
      needsAttention: true,
    };
  }

  return {
    tier: 'ok',
    daysRemaining: days,
    label: `Valid · ${days}d`,
    className: 'text-green-800 bg-green-100',
    color: '#16a34a',
    needsAttention: false,
  };
}

/** Sort order used to surface the most critical machines first. */
export const TPC_TIER_PRIORITY: Record<TPCTier, number> = {
  expired: 0,
  urgent: 1,
  'due-soon': 2,
  reminder: 3,
  unknown: 4,
  ok: 5,
};
