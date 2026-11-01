import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

interface StageTrackerProps {
  /** Ordered list of all stages in the pipeline */
  stages: readonly string[];
  /** The current stage the job is in */
  current: string;
  className?: string;
}

/**
 * Horizontal stepper showing a job's progress through an ordered pipeline.
 * Stages before the current are "done", the current is "active", the rest "upcoming".
 */
export function StageTracker({ stages, current, className }: StageTrackerProps) {
  const currentIndex = stages.indexOf(current);

  return (
    <ol className={cn('flex w-full items-center', className)}>
      {stages.map((stage, i) => {
        const done = currentIndex >= 0 && i < currentIndex;
        const active = i === currentIndex;
        const isLast = i === stages.length - 1;

        return (
          <li key={stage} className={cn('flex items-center', !isLast && 'flex-1')}>
            <div className="flex flex-col items-center gap-1.5">
              <span
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-semibold transition-colors',
                  done && 'border-emerald-500 bg-emerald-500 text-white',
                  active && 'border-sky-500 bg-sky-500 text-white ring-4 ring-sky-500/20',
                  !done && !active && 'border-border bg-muted text-muted-foreground'
                )}
              >
                {done ? <Check className="h-4 w-4" /> : i + 1}
              </span>
              <span
                className={cn(
                  'max-w-[80px] text-center text-[11px] leading-tight',
                  active ? 'font-semibold text-foreground' : 'text-muted-foreground'
                )}
              >
                {stage}
              </span>
            </div>
            {!isLast && (
              <span
                className={cn(
                  'mx-1 h-0.5 flex-1 rounded transition-colors',
                  done ? 'bg-emerald-500' : 'bg-border'
                )}
                aria-hidden
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
