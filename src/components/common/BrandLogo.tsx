import { cn } from '@/lib/utils';
import { BRAND } from '@/constants/brand';

/**
 * AxleOps logo mark — an axle/gear glyph in the brand gradient.
 * `showText` renders the wordmark next to it.
 */
export function BrandLogo({
  size = 'md',
  showText = true,
  subtitle,
  className,
}: {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  subtitle?: string;
  className?: string;
}) {
  const box = size === 'lg' ? 'h-12 w-12' : size === 'sm' ? 'h-9 w-9' : 'h-11 w-11';
  const icon = size === 'lg' ? 'h-7 w-7' : size === 'sm' ? 'h-5 w-5' : 'h-6 w-6';
  const title = size === 'lg' ? 'text-xl' : 'text-base';

  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <div
        className={cn('flex shrink-0 items-center justify-center rounded-xl text-white shadow-sm', box)}
        style={{ background: `linear-gradient(135deg, ${BRAND.colors.primary}, ${BRAND.colors.accent})` }}
      >
        <AxleGlyph className={icon} />
      </div>
      {showText && (
        <div className="min-w-0 leading-tight">
          <p className={cn('truncate font-bold tracking-tight text-foreground', title)}>
            {BRAND.name}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">{subtitle ?? BRAND.tagline}</p>
        </div>
      )}
    </div>
  );
}

function AxleGlyph({ className }: { className?: string }) {
  // Two wheels on an axle — simple, recognizable fleet/axle mark.
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <circle cx="6" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="18" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="6" cy="12" r="0.9" fill="currentColor" />
      <circle cx="18" cy="12" r="0.9" fill="currentColor" />
      <path d="M9.2 12h5.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
