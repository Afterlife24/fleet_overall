import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ApiErrorNotice, describeApiError } from '@/components/common/ApiStatus';
import { fetchInvoice, useCancelInvoice, useReportInvoicePayment } from '@/hooks/api/useInvoicesApi';
import type { InvoiceDto, ReportedPaymentStatus } from '@/services/api/invoices';
import { toastSuccess } from '@/lib/toast-helper';

const selectClass = 'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm';

/** Cancels the latest Draft invoice of a quotation. A reason is required; the server rejects any other invoice. */
export function CancelInvoiceDialog({ invoice, onClose }: { invoice: InvoiceDto | null; onClose: () => void }) {
  const cancel = useCancelInvoice();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [rowVersion, setRowVersion] = useState(0);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    if (!invoice) return;
    setReason(''); setError(null); setRowVersion(invoice.rowVersion);
  }, [invoice]);

  const submit = async () => {
    if (!invoice) return;
    setError(null);
    try {
      await cancel.mutateAsync({ id: invoice.id, rowVersion, reason: reason.trim() });
      toastSuccess('Invoice cancelled');
      onClose();
    } catch (err) {
      setError(err); // the reason stays in the box
    }
  };

  const reload = async () => {
    if (!invoice) return;
    setReloading(true);
    try {
      setRowVersion((await fetchInvoice(invoice.id)).rowVersion);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setReloading(false);
    }
  };

  return (
    <Dialog open={!!invoice} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Cancel invoice {invoice?.invoiceNo}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {error != null && <ApiErrorNotice error={error} onReload={() => void reload()} reloading={reloading} />}
          <p className="text-sm text-muted-foreground">
            Only the latest Draft invoice of a quotation can be cancelled. Its billing period becomes available again.
          </p>
          <div className="space-y-1">
            <label htmlFor="invoice-cancel-reason" className="text-xs font-medium text-muted-foreground">Reason <span className="text-rose-500">*</span></label>
            <Textarea id="invoice-cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Keep invoice</Button>
          <Button type="button" variant="destructive" disabled={!reason.trim() || cancel.isPending} onClick={() => void submit()}>
            {cancel.isPending ? 'Cancelling...' : 'Cancel invoice'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Records the payment state reported by the accounting system. The app does not collect payments itself. */
export function PaymentStatusDialog({ invoice, onClose }: { invoice: InvoiceDto | null; onClose: () => void }) {
  const report = useReportInvoicePayment();
  const [status, setStatus] = useState<ReportedPaymentStatus>('Paid');
  const [amountDue, setAmountDue] = useState('0.00');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [rowVersion, setRowVersion] = useState(0);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    if (!invoice) return;
    const current: ReportedPaymentStatus = invoice.status === 'Overdue' ? 'Overdue' : invoice.status === 'Paid' ? 'Paid' : 'Sent';
    setStatus(current === 'Sent' ? 'Paid' : current);
    setAmountDue(current === 'Sent' ? '0.00' : invoice.amountDue);
    setReason(''); setError(null); setRowVersion(invoice.rowVersion);
  }, [invoice]);

  const pick = (s: ReportedPaymentStatus) => {
    setStatus(s);
    if (s === 'Paid') setAmountDue('0.00');
    else if (invoice && Number(amountDue) === 0) setAmountDue(invoice.totalAmount);
  };

  const submit = async () => {
    if (!invoice) return;
    setError(null);
    try {
      await report.mutateAsync({ id: invoice.id, rowVersion, body: { status, amountDue: status === 'Paid' ? '0.00' : amountDue, reason: reason.trim() } });
      toastSuccess('Payment status recorded');
      onClose();
    } catch (err) {
      setError(err);
    }
  };

  const reload = async () => {
    if (!invoice) return;
    setReloading(true);
    try {
      setRowVersion((await fetchInvoice(invoice.id)).rowVersion);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setReloading(false);
    }
  };

  const fieldErrors = error ? describeApiError(error).fieldErrors : {};

  return (
    <Dialog open={!!invoice} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Report payment status: {invoice?.invoiceNo}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {error != null && <ApiErrorNotice error={error} onReload={() => void reload()} reloading={reloading} />}
          <p className="text-sm text-muted-foreground">
            Records the state reported by the accounting system. Invoice total: {invoice?.currencyCode} {invoice?.totalAmount}.
          </p>
          <div className="space-y-1">
            <label htmlFor="invoice-pay-status" className="text-xs font-medium text-muted-foreground">Status</label>
            <select id="invoice-pay-status" className={selectClass} value={status} onChange={(e) => pick(e.target.value as ReportedPaymentStatus)}>
              <option value="Paid">Paid</option>
              <option value="Overdue">Overdue</option>
              <option value="Sent">Sent (unpaid, not overdue)</option>
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="invoice-pay-due" className="text-xs font-medium text-muted-foreground">Amount due</label>
            <Input id="invoice-pay-due" type="number" min={0} step="0.01" value={status === 'Paid' ? '0.00' : amountDue}
              disabled={status === 'Paid'} onChange={(e) => setAmountDue(e.target.value)} />
            {fieldErrors.amountDue && <p className="text-xs text-rose-500">{fieldErrors.amountDue}</p>}
          </div>
          <div className="space-y-1">
            <label htmlFor="invoice-pay-reason" className="text-xs font-medium text-muted-foreground">Reason / reference <span className="text-rose-500">*</span></label>
            <Textarea id="invoice-pay-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Close</Button>
          <Button type="button" disabled={!reason.trim() || report.isPending} onClick={() => void submit()}>
            {report.isPending ? 'Saving...' : 'Record status'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
