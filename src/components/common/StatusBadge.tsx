import { cn } from '@/lib/utils';
import { getStatusColor } from '@/utils/statusColors';

interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
  dot?: boolean;
  className?: string;
}

export function StatusBadge({ status, size = 'md', dot = true, className }: StatusBadgeProps) {
  const c = getStatusColor(status);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap',
        c.bg,
        c.text,
        c.border,
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
        className
      )}
    >
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', c.dot)} />}
      {status}
    </span>
  );
}
