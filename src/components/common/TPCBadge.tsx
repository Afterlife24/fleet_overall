import { cn } from '@/lib/utils';
import { ShieldCheck, ShieldAlert, ShieldX } from 'lucide-react';
import { getTPCStatus } from '@/constants/tpcStatus';

interface TPCBadgeProps {
  tpcExpiryDate?: string | null;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Compact badge showing TPC certification status with a colour that escalates
 * as expiry approaches (green → yellow → orange → red) and stays red once expired.
 */
export function TPCBadge({ tpcExpiryDate, size = 'md', className }: TPCBadgeProps) {
  const status = getTPCStatus(tpcExpiryDate);

  const Icon =
    status.tier === 'expired' || status.tier === 'unknown'
      ? ShieldX
      : status.needsAttention
        ? ShieldAlert
        : ShieldCheck;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap',
        status.className,
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
        className
      )}
      title={`TPC: ${status.label}`}
    >
      <Icon className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      {status.label}
    </span>
  );
}
