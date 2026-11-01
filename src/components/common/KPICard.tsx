import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface KPICardProps {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  trend?: number;
  trendLabel?: string;
  color?: 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'teal' | 'orange' | 'slate' | 'indigo';
  onClick?: () => void;
}

const COLOR_MAP = {
  blue: { icon: 'text-sky-600 dark:text-sky-400', bg: 'bg-sky-50 dark:bg-sky-950/40' },
  green: { icon: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/40' },
  amber: { icon: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/40' },
  red: { icon: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-50 dark:bg-rose-950/40' },
  purple: { icon: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-50 dark:bg-violet-950/40' },
  teal: { icon: 'text-teal-600 dark:text-teal-400', bg: 'bg-teal-50 dark:bg-teal-950/40' },
  orange: { icon: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-50 dark:bg-orange-950/40' },
  indigo: { icon: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-50 dark:bg-indigo-950/40' },
  slate: { icon: 'text-slate-600 dark:text-slate-300', bg: 'bg-slate-100 dark:bg-slate-800/40' },
};

export function KPICard({ label, value, icon: Icon, trend, trendLabel, color = 'slate', onClick }: KPICardProps) {
  const c = COLOR_MAP[color];
  return (
    <Card
      className={cn('p-4 transition-all', onClick && 'cursor-pointer hover:shadow-md hover:-translate-y-0.5')}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide leading-tight">{label}</p>
          <p className="mt-2 text-2xl font-semibold text-foreground tabular-nums">{value}</p>
          {(trend !== undefined || trendLabel) && (
            <div className="mt-2 flex items-center gap-1.5 text-xs">
              {trend !== undefined && (
                <span className={cn('inline-flex items-center gap-0.5 font-medium', trend >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                  {trend >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {Math.abs(trend)}%
                </span>
              )}
              {trendLabel && <span className="text-muted-foreground">{trendLabel}</span>}
            </div>
          )}
        </div>
        <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', c.bg, c.icon)}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </Card>
  );
}
