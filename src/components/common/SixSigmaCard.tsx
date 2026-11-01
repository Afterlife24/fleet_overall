import { Card } from '@/components/ui/card';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SixSigmaCardProps {
  label: string;
  value: string | number;
  target: string | number;
  unit?: string;
  targetLabel?: string;
  status: 'good' | 'warning' | 'bad';
  description?: string;
}

export function SixSigmaCard({
  label,
  value,
  target,
  unit = '',
  targetLabel = 'Target',
  status,
  description,
}: SixSigmaCardProps) {
  const statusConfig = {
    good: {
      gradient: 'from-emerald-500/20 via-teal-500/10 to-transparent',
      iconBg: 'bg-gradient-to-br from-emerald-500/20 to-teal-500/10',
      iconColor: 'text-emerald-600 dark:text-emerald-400',
      badgeBg: 'bg-emerald-500/10 backdrop-blur-sm',
      badgeColor: 'text-emerald-700 dark:text-emerald-300',
      borderColor: 'border-emerald-500/20',
      icon: TrendingUp,
      label: 'On Target',
      glowColor: 'shadow-emerald-500/20',
    },
    warning: {
      gradient: 'from-amber-500/20 via-orange-500/10 to-transparent',
      iconBg: 'bg-gradient-to-br from-amber-500/20 to-orange-500/10',
      iconColor: 'text-amber-600 dark:text-amber-400',
      badgeBg: 'bg-amber-500/10 backdrop-blur-sm',
      badgeColor: 'text-amber-700 dark:text-amber-300',
      borderColor: 'border-amber-500/20',
      icon: Minus,
      label: 'Needs Improvement',
      glowColor: 'shadow-amber-500/20',
    },
    bad: {
      gradient: 'from-rose-500/20 via-red-500/10 to-transparent',
      iconBg: 'bg-gradient-to-br from-rose-500/20 to-red-500/10',
      iconColor: 'text-rose-600 dark:text-rose-400',
      badgeBg: 'bg-rose-500/10 backdrop-blur-sm',
      badgeColor: 'text-rose-700 dark:text-rose-300',
      borderColor: 'border-rose-500/20',
      icon: TrendingDown,
      label: 'Below Target',
      glowColor: 'shadow-rose-500/20',
    },
  };

  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <Card className={cn(
      'group relative overflow-hidden transition-all duration-300 hover:shadow-xl',
      config.glowColor,
      config.borderColor
    )}>
      {/* Apple-style gradient background */}
      <div className={cn(
        'absolute inset-0 bg-gradient-to-br opacity-50 transition-opacity duration-500 group-hover:opacity-70',
        config.gradient
      )} />
      
      {/* Glassmorphism overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-background/50 via-background/30 to-transparent backdrop-blur-[2px]" />

      <div className="relative p-6">
        {/* Header with label and icon */}
        <div className="mb-4 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <div className={cn(
            'rounded-xl p-2 shadow-sm transition-transform duration-300 group-hover:scale-110',
            config.iconBg
          )}>
            <Icon className={cn('h-4 w-4', config.iconColor)} />
          </div>
        </div>

        {/* Large value - properly aligned */}
        <div className="mb-3">
          <div className="flex items-baseline gap-1.5">
            <span className="text-5xl font-bold tracking-tight text-foreground">
              {typeof value === 'number' ? value.toFixed(1) : value}
            </span>
            {unit && (
              <span className="text-xl font-medium text-muted-foreground">
                {unit}
              </span>
            )}
          </div>
        </div>

        {/* Target info */}
        <div className="mb-3 flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">{targetLabel}:</span>
          <span className="font-semibold text-foreground">
            {target}{unit}
          </span>
        </div>

        {/* Description */}
        {description && (
          <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}

        {/* Status badge - iOS style pill */}
        <div className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
          config.badgeBg,
          config.badgeColor,
          config.borderColor
        )}>
          <div className={cn(
            'h-1.5 w-1.5 rounded-full',
            config.iconColor.replace('text-', 'bg-')
          )} />
          {config.label}
        </div>
      </div>
    </Card>
  );
}
