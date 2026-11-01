import { AppNotification, NotificationType, NotificationCategory } from '@/types/notification';
import { makeEntity } from './branches';
import { pick, randInt, hoursAgoISO, daysAgoISO, NOW_ISO, randId } from './_gen';
import { machines } from './machines';
import { getTPCStatus } from '@/constants/tpcStatus';

const TEMPLATES: { title: string; message: string; type: NotificationType; category: NotificationCategory }[] = [
  { title: 'Critical Breakdown Reported', message: 'Genie S-85 XC at Dubai Marina site has suffered a hydraulic failure. Technician dispatch required.', type: 'error', category: 'Breakdown' },
  { title: 'PHI Inspection Due', message: '12 machines are due for Pre-Hire Inspection within 48 hours.', type: 'warning', category: 'Inspection' },
  { title: 'Booking Confirmed', message: 'Booking BK-2025-0018 has been approved for Arabtec Construction LLC.', type: 'success', category: 'Booking' },
  { title: 'Parts Delivery Delayed', message: 'Hydraulic seal kit for WJ-2025-0007 delayed by supplier. New ETA: 3 days.', type: 'warning', category: 'Workshop' },
  { title: 'Transport Completed', message: 'TR-2025-0012 delivery to Abu Dhabi site completed successfully.', type: 'success', category: 'Transport' },
  { title: 'Mandatory Check Overdue', message: 'JLG 660SJ (JA-DXB-1003) is 5 days overdue for mandatory inspection.', type: 'error', category: 'Compliance' },
  { title: 'New Damage Claim', message: 'Damage claim filed for boom scratch on JA-AUH-1015 during customer hire.', type: 'warning', category: 'Breakdown' },
  { title: 'Workshop Bay Available', message: 'Bay DXB-A2 is now available after WJ-2025-0003 completion.', type: 'info', category: 'Workshop' },
  { title: 'Telematics Alert', message: 'Battery voltage low on Genie GS-3246 at Sharjah yard. Charging required.', type: 'warning', category: 'System' },
  { title: 'PDI Inspection Passed', message: 'Skyjack SJ6826RT passed PDI with all checks green. Ready for dispatch.', type: 'success', category: 'Inspection' },
  { title: 'License Expiry Warning', message: 'Driver Pat Cummins license expires in 15 days. Renewal required.', type: 'warning', category: 'Compliance' },
  { title: 'Weekly Report Generated', message: 'Fleet utilization report for Week 31 is ready to download.', type: 'info', category: 'System' },
  { title: 'Branch Transfer Completed', message: '2 machines successfully transferred from Dubai to Abu Dhabi branch.', type: 'success', category: 'Transport' },
  { title: 'Operator Assigned', message: 'Operator assigned to booking BK-2025-0015 for Emaar Construction site.', type: 'info', category: 'Booking' },
  { title: 'MQD Quality Review', message: 'Maintenance Quality Document review pending for 3 completed jobs.', type: 'warning', category: 'Inspection' },
];

const baseNotifications: AppNotification[] = TEMPLATES.map((t, i) => ({
  ...makeEntity(`ntf-${i + 1}`),
  ...t,
  read: i < 3 ? false : randInt(0, 1) === 1,
  priority: t.type === 'error' ? 'High' : pick(['Low', 'Normal', 'Normal', 'High']),
  actionUrl: pick(['/breakdowns', '/inspections/phi', '/planner', '/workshop', '/transport', '/reports', '/fleet']),
  relatedId: randId(),
}));

/**
 * TPC renewal reminders — generated from live machine data.
 * Ops & workshop are alerted at 30 / 20 / 10 days before expiry, then the
 * reminder escalates to an error (red) once the certificate has lapsed.
 * These are the "safety certification expiring" alerts required by the spec.
 */
const tpcNotifications: AppNotification[] = machines
  .map((m) => {
    const status = getTPCStatus(m.tpcExpiryDate);
    if (!status.needsAttention || status.tier === 'unknown') return null;

    const fleetNo = (m as any).fleetNo ?? m.assetNumber;
    const supplier = m.tpcSupplier ?? 'certifying supplier';

    const type: NotificationType = status.tier === 'expired' || status.tier === 'urgent' ? 'error' : 'warning';
    const priority: AppNotification['priority'] =
      status.tier === 'expired' || status.tier === 'urgent' ? 'High' : 'Normal';

    const title =
      status.tier === 'expired'
        ? 'TPC Certificate EXPIRED'
        : 'TPC Renewal Due';

    const message =
      status.tier === 'expired'
        ? `${m.make} ${m.model} (${fleetNo}) TPC lapsed ${Math.abs(status.daysRemaining ?? 0)} days ago — machine must not go on hire. Chase ${supplier} to renew.`
        : `${m.make} ${m.model} (${fleetNo}) TPC expires in ${status.daysRemaining} days. Ops/workshop to arrange renewal with ${supplier}.`;

    return {
      ...makeEntity(`ntf-tpc-${m.id}`),
      title,
      message,
      type,
      category: 'Compliance' as NotificationCategory,
      read: false,
      priority,
      actionUrl: '/fleet',
      relatedId: m.id,
    } as AppNotification;
  })
  .filter((n): n is AppNotification => n !== null);

export const notifications: AppNotification[] = [...tpcNotifications, ...baseNotifications];
