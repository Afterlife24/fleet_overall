import { AlertTriangle, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/common/EmptyState';
import { ApiClientError, SERVICE_UNAVAILABLE_MESSAGE } from '@/services/api/http';
import { ensureSession, useSessionStore } from '@/services/api/session';
import { cn } from '@/lib/utils';

export interface ApiErrorInfo {
  message: string;
  correlationId: string | null;
  code: string | null;
  stale: boolean;
  unavailable: boolean;
  fieldErrors: Record<string, string>;
}

export const STALE_MESSAGE = 'This record was changed by someone else since you opened it.';

/** Reduces any thrown value to what the screens show: message, correlation id, conflict and availability flags. */
export function describeApiError(err: unknown): ApiErrorInfo {
  if (err instanceof ApiClientError) {
    const unavailable = err.status === 503 || err.code === 'NETWORK_ERROR' || err.code === 'SERVICE_UNAVAILABLE';
    const stale = err.code === 'STALE_VERSION';
    return {
      message: stale ? STALE_MESSAGE : unavailable ? SERVICE_UNAVAILABLE_MESSAGE : err.message,
      correlationId: err.correlationId,
      code: err.code,
      stale,
      unavailable,
      fieldErrors: err.fieldErrors,
    };
  }
  return {
    message: err instanceof Error ? err.message : 'Something went wrong.',
    correlationId: null, code: null, stale: false, unavailable: false, fieldErrors: {},
  };
}

/** The message with its correlation id, for toasts. */
export function errorText(err: unknown): string {
  const e = describeApiError(err);
  return e.correlationId ? `${e.message} (correlation id ${e.correlationId})` : e.message;
}

interface NoticeProps {
  error: unknown;
  /** Re-reads the record after a 409 conflict. Entered values are kept by the caller. */
  onReload?: () => void;
  reloading?: boolean;
  /** Retries a failed read. */
  onRetry?: () => void;
  className?: string;
}

/** A failed request: message, correlation id, a reload offer for 409 STALE_VERSION and a retry for reads. */
export function ApiErrorNotice({ error, onReload, reloading, onRetry, className }: NoticeProps) {
  const e = describeApiError(error);
  return (
    <div role="alert" data-testid="api-error" className={cn('rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200', className)}>
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium">{e.message}</p>
          {e.stale && <p className="text-xs">Reload the latest version to continue. What you entered is kept.</p>}
          {e.correlationId && <p className="text-xs">Correlation ID: <span className="font-mono">{e.correlationId}</span></p>}
          {Object.keys(e.fieldErrors).length > 0 && (
            <ul className="list-disc pl-4 text-xs">
              {Object.entries(e.fieldErrors).map(([field, msg]) => <li key={field}>{field}: {msg}</li>)}
            </ul>
          )}
          <div className="flex gap-2 pt-1">
            {e.stale && onReload && (
              <Button type="button" size="sm" variant="outline" disabled={reloading} onClick={onReload}>
                <RefreshCw className="mr-1 h-3.5 w-3.5" />{reloading ? 'Reloading...' : 'Reload latest'}
              </Button>
            )}
            {!e.stale && onRetry && (
              <Button type="button" size="sm" variant="outline" onClick={onRetry}>
                <RefreshCw className="mr-1 h-3.5 w-3.5" />Try again
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Shown next to screens that run on the development fixture identity. */
export function DevFixtureBadge() {
  const dev = useSessionStore((s) => s.devFixtureAuth);
  if (!dev) return null;
  return (
    <span
      data-testid="dev-fixture-badge"
      title="Signed in with the development fixture identity"
      className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800"
    >
      <ShieldCheck className="h-3 w-3" />Dev Fixture Auth
    </span>
  );
}

/**
 * Renders `children` once the API session is ready. While it is starting it shows a loading state;
 * when it failed (for example the backend is not running) it shows the error and a retry. No mock data is shown.
 */
export function ApiSessionGate({ children }: { children: React.ReactNode }) {
  const status = useSessionStore((s) => s.status);
  const error = useSessionStore((s) => s.error);
  if (status === 'ready') return <>{children}</>;
  if (status === 'error' || status === 'not-configured') {
    return (
      <div className="mx-auto max-w-xl py-10">
        <ApiErrorNotice error={new Error(error ?? 'Could not start a session')} onRetry={() => void ensureSession()} />
      </div>
    );
  }
  return <LoadingState />;
}
