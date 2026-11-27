import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  useBookings, useCancelBooking, useRequestOffHire, useStartHire, useSubmission,
} from '@/hooks/api/usePlannerApi';
import { toastSuccess } from '@/lib/toast-helper';
import type { Booking } from '@/types/booking';
import { BookingErrorNotice } from './BookingErrorNotice';
import { displayStatus } from './bookingRecord';

const CLOSED = new Set(['On Hire', 'Returned', 'Cancelled']);

interface Props {
  bookingId: string | null;
  onClose: () => void;
  onEdit: (booking: Booking) => void;
}

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="flex justify-between gap-4 text-sm">
    <span className="text-muted-foreground">{label}</span>
    <span className="text-right font-medium">{value || '—'}</span>
  </div>
);

/** One booking with its commands: edit, Start Hire, off-hire request and cancel (with a reason). */
export function BookingDetailDialog({ bookingId, onClose, onEdit }: Props) {
  const bookings = useBookings();
  const booking = bookings.data?.find((b) => b.id === bookingId) ?? null;
  const startHire = useStartHire();
  const offHire = useRequestOffHire();
  const cancel = useCancelBooking();
  const submission = useSubmission();
  const [error, setError] = useState<unknown>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [reloading, setReloading] = useState(false);

  useEffect(() => { setError(null); setCancelling(false); setReason(''); }, [bookingId]);

  if (!bookingId) return null;
  const today = new Date().toISOString().slice(0, 10);
  const busy = startHire.isPending || offHire.isPending || cancel.isPending;
  const status = booking ? displayStatus(booking, today) : '';
  const planned = !!booking && !CLOSED.has(booking.status);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setError(null);
    try {
      await fn();
      toastSuccess(done);
      return true;
    } catch (err) {
      setError(err);
      return false;
    }
  };

  const reload = async () => {
    setReloading(true);
    try { await bookings.refetch(); setError(null); } finally { setReloading(false); }
  };

  const onStartHire = async () => {
    if (!booking) return;
    const ok = await run(
      () => startHire.mutateAsync({ id: booking.id, rowVersion: booking.rowVersion ?? 0, submissionId: submission.id() }),
      'Hire started. A linked quotation in Awaiting or Tender moved to Won.',
    );
    if (ok) submission.renew();
  };

  const onCancel = async () => {
    if (!booking || !reason.trim()) return;
    const ok = await run(
      () => cancel.mutateAsync({ id: booking.id, rowVersion: booking.rowVersion ?? 0, reason: reason.trim() }),
      'Booking cancelled',
    );
    if (ok) { setCancelling(false); setReason(''); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Booking {booking?.reference ?? ''}</DialogTitle>
          <DialogDescription>{booking ? `${booking.customerName} · ${booking.assetNumber}` : 'Booking not found'}</DialogDescription>
        </DialogHeader>
        {error != null && <BookingErrorNotice error={error} onReload={() => void reload()} reloading={reloading} />}
        {booking && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline">{status}</Badge>
              {booking.offHireRequestedAt && !booking.returnedAt && <Badge variant="secondary">Off-hire requested</Badge>}
            </div>
            <Row label="Machine" value={`${booking.assetNumber} ${booking.machineModel}`} />
            <Row label="Branch" value={booking.branchName} />
            <Row label="Period" value={`${booking.startDate} to ${booking.endDate}`} />
            <Row label="Hire agreement" value={booking.agreementNo} />
            <Row label="Site" value={booking.deliveryAddress} />
            <Row label="Contact" value={booking.contactPhone} />
            <Row label="Daily rate" value={booking.dailyRate.toLocaleString()} />
            <Row label="Total" value={booking.totalValue.toLocaleString()} />
            <Row label="On hire since" value={booking.onHireAt?.slice(0, 16).replace('T', ' ')} />
            <Row label="Returned" value={booking.returnedAt?.slice(0, 16).replace('T', ' ')} />
            {booking.notes && <Row label="Notes" value={booking.notes} />}
          </div>
        )}
        {cancelling && (
          <div className="space-y-2">
            <label htmlFor="bk-cancel-reason" className="text-sm font-medium">Cancellation reason*</label>
            <Textarea id="bk-cancel-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        )}
        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="outline" onClick={onClose}>Close</Button>
          {booking && (
            <div className="flex flex-wrap gap-2">
              {planned && !cancelling && (
                <Button type="button" variant="outline" disabled={busy} onClick={() => setCancelling(true)}>Cancel booking</Button>
              )}
              {cancelling && (
                <>
                  <Button type="button" variant="ghost" disabled={busy} onClick={() => setCancelling(false)}>Keep booking</Button>
                  <Button type="button" variant="destructive" disabled={busy || !reason.trim()} onClick={() => void onCancel()}>
                    {cancel.isPending ? 'Cancelling...' : 'Confirm cancel'}
                  </Button>
                </>
              )}
              {(planned || booking.status === 'On Hire') && !cancelling && (
                <Button type="button" variant="outline" disabled={busy} onClick={() => onEdit(booking)}>Edit</Button>
              )}
              {booking.status === 'On Hire' && !booking.returnedAt && !cancelling && (
                <Button
                  type="button" variant="outline" disabled={busy || !!booking.offHireRequestedAt}
                  onClick={() => void run(() => offHire.mutateAsync({ id: booking.id, rowVersion: booking.rowVersion ?? 0 }), 'Off-hire requested')}
                >
                  {booking.offHireRequestedAt ? 'Off-hire requested' : 'Request off-hire'}
                </Button>
              )}
              {planned && !cancelling && (
                <Button type="button" className="bg-emerald-600 hover:bg-emerald-700 text-white" disabled={busy} onClick={() => void onStartHire()}>
                  {startHire.isPending ? 'Starting...' : 'Start Hire'}
                </Button>
              )}
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
