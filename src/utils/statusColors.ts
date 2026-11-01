// Centralized color mapping for statuses — used by StatusBadge and charts.
// Returns Tailwind-friendly inline styles / class fragments.

type ColorSet = { bg: string; text: string; border: string; dot: string; solid: string };

const PALETTE: Record<string, ColorSet> = {
  green:   { bg: 'bg-emerald-50 dark:bg-emerald-950/40', text: 'text-emerald-700 dark:text-emerald-400', border: 'border-emerald-200 dark:border-emerald-800', dot: 'bg-emerald-500', solid: 'bg-emerald-500' },
  blue:    { bg: 'bg-sky-50 dark:bg-sky-950/40', text: 'text-sky-700 dark:text-sky-400', border: 'border-sky-200 dark:border-sky-800', dot: 'bg-sky-500', solid: 'bg-sky-500' },
  amber:   { bg: 'bg-amber-50 dark:bg-amber-950/40', text: 'text-amber-700 dark:text-amber-400', border: 'border-amber-200 dark:border-amber-800', dot: 'bg-amber-500', solid: 'bg-amber-500' },
  red:     { bg: 'bg-rose-50 dark:bg-rose-950/40', text: 'text-rose-700 dark:text-rose-400', border: 'border-rose-200 dark:border-rose-800', dot: 'bg-rose-500', solid: 'bg-rose-500' },
  purple:  { bg: 'bg-violet-50 dark:bg-violet-950/40', text: 'text-violet-700 dark:text-violet-400', border: 'border-violet-200 dark:border-violet-800', dot: 'bg-violet-500', solid: 'bg-violet-500' },
  slate:   { bg: 'bg-slate-100 dark:bg-slate-800/40', text: 'text-slate-600 dark:text-slate-300', border: 'border-slate-200 dark:border-slate-700', dot: 'bg-slate-400', solid: 'bg-slate-500' },
  teal:    { bg: 'bg-teal-50 dark:bg-teal-950/40', text: 'text-teal-700 dark:text-teal-400', border: 'border-teal-200 dark:border-teal-800', dot: 'bg-teal-500', solid: 'bg-teal-500' },
  orange:  { bg: 'bg-orange-50 dark:bg-orange-950/40', text: 'text-orange-700 dark:text-orange-400', border: 'border-orange-200 dark:border-orange-800', dot: 'bg-orange-500', solid: 'bg-orange-500' },
  indigo:  { bg: 'bg-indigo-50 dark:bg-indigo-950/40', text: 'text-indigo-700 dark:text-indigo-400', border: 'border-indigo-200 dark:border-indigo-800', dot: 'bg-indigo-500', solid: 'bg-indigo-500' },
};

const STATUS_COLORS: Record<string, keyof typeof PALETTE> = {
  // Machine status
  'Available': 'green',
  'On Hire': 'blue',
  'Under Repair': 'amber',
  'In Workshop': 'purple',
  'PDI': 'teal',
  'PHI': 'indigo',
  'Transport': 'orange',
  'Breakdown': 'red',
  'Offline': 'slate',
  // Booking status
  'Draft': 'slate',
  'Pending Approval': 'amber',
  'Approved': 'blue',
  'Allocated': 'indigo',
  'Returned': 'teal',
  'Cancelled': 'red',
  // Workshop
  'Waiting Parts': 'amber',
  'Waiting Mechanic': 'orange',
  'Work In Progress': 'blue',
  'Quality Check': 'purple',
  // Inspection
  'Pending': 'slate',
  'In Progress': 'blue',
  'Passed': 'green',
  'Failed': 'red',
  'Awaiting Approval': 'amber',
  // Breakdown
  'Open': 'red',
  'Assigned': 'orange',
  'Resolved': 'green',
  'Closed': 'slate',
  // Severity / Priority
  'Low': 'slate',
  'Medium': 'amber',
  'High': 'orange',
  'Critical': 'red',
  // User / generic
  'Active': 'green',
  'Inactive': 'slate',
  'Suspended': 'red',
  'On Leave': 'amber',
  'Off Duty': 'slate',
  'On Delivery': 'blue',
  'Returning': 'teal',
  'On Route': 'blue',
  'Maintenance': 'amber',
  'Occupied': 'orange',
  // Transport job
  'Scheduled': 'slate',
  'Loading': 'amber',
  'In Transit': 'blue',
  'Delivered': 'green',
  'Completed': 'green',
  // Job card
  'On Hold': 'amber',
  // Cross hire
  'Enquiry': 'slate',
  'Confirmed': 'indigo',
  'Off Hire': 'amber',
};

export function getStatusColor(status: string): ColorSet {
  return PALETTE[STATUS_COLORS[status] || 'slate'];
}

export function getColorSet(name: keyof typeof PALETTE): ColorSet {
  return PALETTE[name];
}

export const CHART_COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1'];
