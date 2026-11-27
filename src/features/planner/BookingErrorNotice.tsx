import { ApiErrorNotice } from '@/components/common/ApiStatus';
import { ApiClientError } from '@/services/api/http';

export const BOOKING_CONFLICT_MESSAGE = 'This machine is already booked for these dates. Pick other dates or another machine.';
export const REOPEN_REQUIRED_MESSAGE = 'The quotation is Lost. Reopen it in CRM first, then start hire again.';

/** Gives the planner's two business errors their plain wording; every other error is returned unchanged. */
export function plannerError(err: unknown): unknown {
  if (err instanceof ApiClientError && (err.code === 'BOOKING_CONFLICT' || err.code === 'REOPEN_REQUIRED')) {
    return new ApiClientError({
      code: err.code,
      message: err.code === 'BOOKING_CONFLICT' ? BOOKING_CONFLICT_MESSAGE : REOPEN_REQUIRED_MESSAGE,
      status: err.status,
      fieldErrors: err.fieldErrors,
      correlationId: err.correlationId,
      retryable: err.retryable,
    });
  }
  return err;
}

interface Props {
  error: unknown;
  onReload?: () => void;
  reloading?: boolean;
  onRetry?: () => void;
  className?: string;
}

/** `ApiErrorNotice` with the planner wording for BOOKING_CONFLICT and REOPEN_REQUIRED. */
export function BookingErrorNotice({ error, ...rest }: Props) {
  return <ApiErrorNotice error={plannerError(error)} {...rest} />;
}
