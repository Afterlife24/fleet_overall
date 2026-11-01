import { cn } from '@/lib/utils';
import { TimelineEvent } from '@/types/common';
import { timeAgo } from '@/utils/format';
import { getStatusColor } from '@/utils/statusColors';

const TYPE_TO_COLOR: Record<TimelineEvent['type'], string> = {
  info: 'bg-sky-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  error: 'bg-rose-500',
  maintenance: 'bg-violet-500',
};

interface TimelineProps {
  events: TimelineEvent[];
  className?: string;
  compact?: boolean;
}

export function Timeline({ events, className, compact }: TimelineProps) {
  if (!events.length) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No activity recorded yet.</p>;
  }
  return (
    <ol className={cn('relative', className)}>
      {events.map((event, i) => (
        <li key={event.id} className="relative flex gap-3 pb-6 last:pb-0">
          {/* line */}
          {i < events.length - 1 && (
            <span className="absolute left-[11px] top-5 bottom-0 w-px bg-border" aria-hidden />
          )}
          {/* dot */}
          <span className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-background', TYPE_TO_COLOR[event.type])} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className={cn('font-medium text-foreground', compact ? 'text-sm' : 'text-sm')}>{event.title}</p>
              <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(event.timestamp)}</span>
            </div>
            {event.description && <p className="mt-0.5 text-xs text-muted-foreground">{event.description}</p>}
            <p className="mt-1 text-xs text-muted-foreground">by {event.actor}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
