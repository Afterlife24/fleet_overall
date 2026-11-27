import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ApiErrorNotice } from '@/components/common/ApiStatus';
import { useSubmission } from '@/hooks/useApiResources';
import { useBookingInvoices, useInitiateCollection, useOnHireBookings } from '@/hooks/api/useCollectionApi';
import { collectionNoteFromDto, mqdFromDto, tpsFromDto, type DocMapContext } from '@/services/api/collectionMappers';
import { browserOrgId } from '@/services/api/readAdapters';
import type { InitiateResult } from '@/services/collectionDocs';
import type { BookingDto } from '@/services/api/bookings';
import type { MqdReportDto, ServiceReportDto } from '@/services/api/documents';

interface InitiateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Selects the On Hire booking of this machine. */
  preselectMachineId?: string;
  /** Selects this On Hire booking. */
  preselectBookingId?: string;
  onCreated?: (result: InitiateResult) => void;
}

const NO_INVOICE = 'none';
const todayIso = () => new Date().toISOString().slice(0, 10);
const bookingLabel = (b: BookingDto) =>
  `${b.fleetNo || b.assetNo}${b.machineModel ? ` – ${b.machineModel}` : ''} · ${b.customerName} · ${b.reference}`;

export function InitiateDialog({ open, onOpenChange, preselectMachineId, preselectBookingId, onCreated }: InitiateDialogProps) {
  const bookingsQuery = useOnHireBookings(open);
  const bookings = useMemo(() => bookingsQuery.data ?? [], [bookingsQuery.data]);
  const initiate = useInitiateCollection();
  const submission = useSubmission();
  const [bookingId, setBookingId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [invoiceId, setInvoiceId] = useState(NO_INVOICE);
  const [remarks, setRemarks] = useState('');
  const [result, setResult] = useState<InitiateResult | null>(null);
  const [error, setError] = useState<unknown>(null);

  const booking = bookings.find((b) => b.id === bookingId);
  const invoicesQuery = useBookingInvoices(booking);
  const invoices = invoicesQuery.data ?? [];

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setError(null);
    setDate(todayIso());
    setInvoiceId(NO_INVOICE);
    setRemarks('');
    setBookingId(preselectBookingId ?? '');
  }, [open, preselectBookingId]);

  // A machine preselect resolves to its On Hire booking once the bookings are loaded.
  useEffect(() => {
    if (!open || preselectBookingId || !preselectMachineId) return;
    const match = bookings.find((b) => b.machineId === preselectMachineId);
    if (match) setBookingId((cur) => cur || match.id);
  }, [open, preselectBookingId, preselectMachineId, bookings]);

  const canSubmit = !!booking && date !== '' && !result?.ok && !initiate.isPending;

  const handleSubmit = async () => {
    if (!booking || !canSubmit) return;
    setError(null);
    const startedAt = Date.now();
    try {
      const bundle = await initiate.mutateAsync({
        bookingId: booking.id,
        input: {
          scheduledCollectionAt: new Date(`${date}T00:00:00`).toISOString(),
          ...(invoiceId !== NO_INVOICE ? { relatedInvoiceId: invoiceId } : {}),
          ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
        },
        submissionId: submission.id(),
      });
      submission.renew();
      const ctx: DocMapContext = { orgId: browserOrgId(), bookings: new Map([[booking.id, booking]]) };
      const cn = collectionNoteFromDto(bundle.collectionNote, ctx);
      const existing = Date.parse(bundle.collectionNote.createdAt) < startedAt - 5_000;
      const r: InitiateResult = {
        ok: true,
        cn,
        mqd: bundle.mqdReport ? mqdFromDto({ ...bundle.mqdReport, bookingReference: booking.reference } as MqdReportDto, ctx) : undefined,
        tps: bundle.serviceReport
          ? tpsFromDto({ ...bundle.serviceReport, bookingReference: booking.reference, lines: [] } as ServiceReportDto, ctx)
          : undefined,
        notices: existing
          ? [{ level: 'info', message: `An open collection note already exists for this booking (${cn.number}); no new documents were created.` }]
          : bundle.transportJob
            ? [{ level: 'info', message: `Transport job ${bundle.transportJob.reference} was created.` }]
            : [],
      };
      setResult(r);
      onCreated?.(r);
    } catch (err) {
      setError(err);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Initiate Off-Hire / Collection</DialogTitle>
          <DialogDescription>Creates the collection note and linked documents for a booking that is On Hire.</DialogDescription>
        </DialogHeader>
        {bookingsQuery.isError ? (
          <ApiErrorNotice error={bookingsQuery.error} onRetry={() => void bookingsQuery.refetch()} />
        ) : bookingsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading bookings...</p>
        ) : bookings.length === 0 ? (
          <p className="text-sm text-muted-foreground">No bookings are currently On Hire, so there is nothing to collect.</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="initiate-booking">Booking</Label>
              <Select value={bookingId} onValueChange={setBookingId} disabled={!!result?.ok}>
                <SelectTrigger id="initiate-booking">
                  <SelectValue placeholder="Select an On Hire booking" />
                </SelectTrigger>
                <SelectContent>
                  {bookings.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{bookingLabel(b)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="initiate-date">Collection date</Label>
              <Input id="initiate-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={!!result?.ok} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="initiate-invoice">Invoice reference (optional)</Label>
              <Select value={invoiceId} onValueChange={setInvoiceId} disabled={!!result?.ok || !booking}>
                <SelectTrigger id="initiate-invoice">
                  <SelectValue placeholder="No invoice reference" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_INVOICE}>No invoice reference</SelectItem>
                  {invoices.map((i) => (
                    <SelectItem key={i.id} value={i.id}>{i.invoiceNo}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="initiate-remarks">Remarks (optional)</Label>
              <Input id="initiate-remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} disabled={!!result?.ok} />
            </div>
          </div>
        )}
        {error != null && <ApiErrorNotice error={error} />}
        {result && (
          <div className="space-y-2 text-sm">
            {result.ok && (
              <ul className="list-disc pl-5">
                {result.cn && <li>Collection Note: {result.cn.number}</li>}
                {result.mqd && <li>MQD: {result.mqd.number}</li>}
                {result.tps && <li>Third-Party Services: {result.tps.number}</li>}
              </ul>
            )}
            {result.notices.map((n, i) => (
              <p key={i} role={n.level === 'error' ? 'alert' : undefined} className={n.level === 'error' ? 'text-destructive' : 'text-muted-foreground'}>
                {n.message}
              </p>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {result?.ok ? 'Close' : 'Cancel'}
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={!canSubmit}>
            {initiate.isPending ? 'Initiating...' : 'Initiate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default InitiateDialog;
