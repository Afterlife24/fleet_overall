import { useEffect, useMemo, useState } from 'react';
import { Download, FileText, Plus, Upload } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type Column } from '@/components/tables/DataTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LoadingState } from '@/components/common/EmptyState';
import { ApiErrorNotice, ApiSessionGate } from '@/components/common/ApiStatus';
import {
  currentFile, downloadStoredFile, fetchDeliveryNote, useAttachSignedCopy, useBookings, useCreateDeliveryNote,
  useDeliveryNoteDocument, useDeliveryNotes, useGenerateDeliveryNotePdf, useSubmission, useUpdateDeliveryNote,
} from '@/hooks/api/usePlannerApi';
import { downloadBlob } from '@/services/collectionPdf';
import type { DeliveryNoteDto } from '@/services/api/documents';
import type { Booking } from '@/types/booking';
import { toastSuccess } from '@/lib/toast-helper';

const selectClass = 'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm';
/** Bookings a delivery note can be raised for: the machine is allocated or already on hire. */
const DELIVERABLE = new Set(['Allocated', 'On Hire']);

const toLocalInput = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocalInput = (v: string): string | null => (v ? new Date(v).toISOString() : null);

/** Delivery Note page. Lists, creates and edits delivery notes through `/api/v1/delivery-notes`; waits for the API session. */
export function DeliveryNotePage() {
  return (
    <ApiSessionGate>
      <DeliveryNoteScreen />
    </ApiSessionGate>
  );
}

function DeliveryNoteScreen() {
  const notes = useDeliveryNotes();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const columns: Column<DeliveryNoteDto>[] = [
    { key: 'number', header: 'DN No.', sortable: true, render: (r) => <span className="font-mono text-xs font-semibold">{r.number}</span> },
    { key: 'bookingReference', header: 'Booking', sortable: true },
    { key: 'noteDate', header: 'Date', sortable: true },
    { key: 'deliveryAddress', header: 'Delivery address' },
    { key: 'driverName', header: 'Driver', render: (r) => <span>{r.driverName ?? '—'}</span> },
    {
      key: 'deliveredAt', header: 'Delivered',
      render: (r) => r.deliveredAt ? <Badge variant="outline">{r.deliveredAt.slice(0, 10)}</Badge> : <span className="text-muted-foreground">Pending</span>,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Delivery Note"
        description="Proof of delivery for a booking: one delivery note per booking, with a stored PDF and a signed copy"
        actions={<Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="mr-1.5 h-4 w-4" />New Delivery Note</Button>}
      />
      {notes.isError && <ApiErrorNotice error={notes.error} onRetry={() => void notes.refetch()} />}
      {notes.isLoading && <LoadingState />}
      {notes.data && (
        <DataTable<DeliveryNoteDto>
          columns={columns}
          data={notes.data}
          searchable
          searchPlaceholder="Search delivery notes..."
          searchKeys={['number', 'bookingReference', 'driverName', 'deliveryAddress']}
          onRowClick={(r) => setSelectedId(r.id)}
          rowKey={(r) => r.id}
          pageSize={10}
          emptyMessage="No delivery notes yet. Click 'New Delivery Note' to add one."
        />
      )}
      <CreateDialog
        open={createOpen}
        existing={notes.data ?? []}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => { setCreateOpen(false); setSelectedId(id); }}
      />
      {selectedId && <DetailDialog id={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

function CreateDialog({ open, existing, onClose, onCreated }: {
  open: boolean; existing: DeliveryNoteDto[]; onClose: () => void; onCreated: (id: string) => void;
}) {
  const bookings = useBookings();
  const create = useCreateDeliveryNote();
  const submission = useSubmission();
  const [bookingId, setBookingId] = useState('');
  const [noteDate, setNoteDate] = useState(new Date().toISOString().slice(0, 10));
  const [address, setAddress] = useState('');
  const [driverName, setDriverName] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!open) return;
    setBookingId(''); setAddress(''); setDriverName(''); setNotes(''); setError(null);
    setNoteDate(new Date().toISOString().slice(0, 10));
  }, [open]);

  const taken = useMemo(() => new Set(existing.map((d) => d.bookingId)), [existing]);
  const options = (bookings.data ?? []).filter((b) => DELIVERABLE.has(b.status) && !b.returnedAt && !taken.has(b.id));

  const pick = (id: string) => {
    setBookingId(id);
    const b = options.find((x) => x.id === id);
    setAddress(b?.deliveryAddress ?? '');
  };

  const save = async () => {
    setError(null);
    try {
      const dn = await create.mutateAsync({
        body: {
          bookingId, noteDate, ...(address.trim() ? { deliveryAddress: address.trim() } : {}),
          driverName: driverName.trim() || null, notes: notes.trim() || null,
        },
        submissionId: submission.id(),
      });
      submission.renew();
      toastSuccess(`Delivery note ${dn.number} created`);
      onCreated(dn.id);
    } catch (err) {
      setError(err); // entered values are kept
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Delivery Note</DialogTitle>
          <DialogDescription>Choose an Allocated or On Hire booking that has no delivery note yet.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {error != null && <ApiErrorNotice error={error} />}
          <div className="space-y-1">
            <label htmlFor="dn-booking" className="text-xs font-medium text-muted-foreground">Booking <span className="text-rose-500">*</span></label>
            <select id="dn-booking" className={selectClass} value={bookingId} onChange={(e) => pick(e.target.value)}>
              <option value="">Select a booking</option>
              {options.map((b) => <option key={b.id} value={b.id}>{b.reference} · {b.customerName} · {b.assetNumber} · {b.status}</option>)}
            </select>
            {bookings.isLoading && <p className="text-xs text-muted-foreground">Loading bookings...</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="dn-date" className="text-xs font-medium text-muted-foreground">Date</label>
              <Input id="dn-date" type="date" value={noteDate} onChange={(e) => setNoteDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label htmlFor="dn-driver" className="text-xs font-medium text-muted-foreground">Driver</label>
              <Input id="dn-driver" value={driverName} onChange={(e) => setDriverName(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <label htmlFor="dn-address" className="text-xs font-medium text-muted-foreground">Delivery address</label>
            <Input id="dn-address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label htmlFor="dn-notes" className="text-xs font-medium text-muted-foreground">Notes</label>
            <Textarea id="dn-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!bookingId || create.isPending} onClick={() => void save()}>
            {create.isPending ? 'Creating...' : 'Create Delivery Note'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const notes = useDeliveryNotes();
  const bookings = useBookings();
  const dn = notes.data?.find((d) => d.id === id) ?? null;
  const booking: Booking | undefined = bookings.data?.find((b) => b.id === dn?.bookingId);
  const document = useDeliveryNoteDocument(id);
  const update = useUpdateDeliveryNote();
  const generate = useGenerateDeliveryNotePdf();
  const attach = useAttachSignedCopy();
  const genSubmission = useSubmission();
  const attachSubmission = useSubmission();

  const [deliveredAt, setDeliveredAt] = useState('');
  const [receivedByName, setReceivedByName] = useState('');
  const [driverName, setDriverName] = useState('');
  const [notesText, setNotesText] = useState('');
  const [rowVersion, setRowVersion] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [reloading, setReloading] = useState(false);
  const [signedFile, setSignedFile] = useState<File | null>(null);
  const [replaceReason, setReplaceReason] = useState('');
  const [loaded, setLoaded] = useState(false);

  // Fill the form once when the note first arrives; later list refreshes never overwrite what was typed.
  useEffect(() => {
    if (!dn || loaded) return;
    setDeliveredAt(toLocalInput(dn.deliveredAt));
    setReceivedByName(dn.receivedByName ?? '');
    setDriverName(dn.driverName ?? '');
    setNotesText(dn.notes ?? '');
    setRowVersion(dn.rowVersion);
    setLoaded(true);
  }, [dn, loaded]);

  const doc = document.data ?? null;
  const pdf = currentFile(doc, 'Generated PDF');
  const signed = currentFile(doc, 'Signed Copy');

  const patch = () => ({
    deliveredAt: fromLocalInput(deliveredAt),
    receivedByName: receivedByName.trim() || null,
    driverName: driverName.trim() || null,
    notes: notesText.trim() || null,
  });

  const save = async (): Promise<DeliveryNoteDto | null> => {
    if (!dn) return null;
    setError(null);
    try {
      const saved = await update.mutateAsync({ id: dn.id, rowVersion, patch: patch() });
      setRowVersion(saved.rowVersion);
      toastSuccess('Delivery note saved');
      return saved;
    } catch (err) {
      setError(err); // the form keeps every entered value
      return null;
    }
  };

  const reload = async () => {
    if (!dn) return;
    setReloading(true);
    try {
      setRowVersion((await fetchDeliveryNote(dn.id)).rowVersion); // entered values are not touched
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setReloading(false);
    }
  };

  const onGenerate = async () => {
    if (!dn) return;
    setError(null);
    const saved = await save(); // the PDF shows what is on screen, so save first
    if (!saved) return;
    try {
      await generate.mutateAsync({ dn: saved, booking, submissionId: genSubmission.id() });
      genSubmission.renew();
      toastSuccess('PDF generated and stored');
    } catch (err) {
      setError(err);
    }
  };

  const onDownload = async (file: typeof pdf) => {
    if (!file) return;
    setError(null);
    try {
      downloadBlob(await downloadStoredFile(file), file.originalName);
    } catch (err) {
      setError(err);
    }
  };

  const onAttach = async () => {
    if (!dn || !doc || !signedFile) return;
    setError(null);
    try {
      await attach.mutateAsync({
        dnId: dn.id, doc, file: signedFile, replacementReason: signed ? replaceReason.trim() : undefined,
        submissionId: attachSubmission.id(),
      });
      attachSubmission.renew();
      setSignedFile(null); setReplaceReason('');
      toastSuccess('Signed copy stored');
    } catch (err) {
      setError(err);
    }
  };

  const saving = update.isPending || generate.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{dn ? `Delivery Note ${dn.number}` : 'Delivery Note'}</DialogTitle>
          <DialogDescription>
            {dn ? `Booking ${dn.bookingReference}${booking ? ` · ${booking.customerName} · ${booking.assetNumber}` : ''}` : 'Loading...'}
          </DialogDescription>
        </DialogHeader>
        {error != null && <ApiErrorNotice error={error} onReload={() => void reload()} reloading={reloading} />}
        {!dn && <LoadingState />}
        {dn && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <span className="text-xs font-medium text-muted-foreground">Delivery address</span>
                <p className="text-sm">{dn.deliveryAddress}</p>
              </div>
              <div className="space-y-1">
                <label htmlFor="dn-delivered" className="text-xs font-medium text-muted-foreground">Delivered at</label>
                <Input id="dn-delivered" type="datetime-local" value={deliveredAt} onChange={(e) => setDeliveredAt(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label htmlFor="dn-received" className="text-xs font-medium text-muted-foreground">Received by</label>
                <Input id="dn-received" value={receivedByName} onChange={(e) => setReceivedByName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label htmlFor="dn-driver-edit" className="text-xs font-medium text-muted-foreground">Driver</label>
                <Input id="dn-driver-edit" value={driverName} onChange={(e) => setDriverName(e.target.value)} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <label htmlFor="dn-notes-edit" className="text-xs font-medium text-muted-foreground">Notes</label>
                <Textarea id="dn-notes-edit" rows={2} value={notesText} onChange={(e) => setNotesText(e.target.value)} />
              </div>
            </div>

            <div className="space-y-3 rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Delivery note PDF</span>
                {pdf ? <Badge variant="outline">Stored</Badge> : <Badge variant="secondary">Not generated</Badge>}
                <div className="ml-auto flex gap-2">
                  <Button type="button" size="sm" disabled={saving} onClick={() => void onGenerate()}>
                    {generate.isPending ? 'Generating...' : pdf ? 'Regenerate PDF' : 'Generate PDF'}
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={!pdf} onClick={() => void onDownload(pdf)}>
                    <Download className="mr-1 h-4 w-4" />Download
                  </Button>
                </div>
              </div>
              <div className="space-y-2 border-t pt-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Upload className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Signed copy</span>
                  {signed ? <Badge variant="outline">{signed.originalName}</Badge> : <Badge variant="secondary">None</Badge>}
                  {signed && (
                    <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={() => void onDownload(signed)}>
                      <Download className="mr-1 h-4 w-4" />Download
                    </Button>
                  )}
                </div>
                <input
                  aria-label="Signed copy file" type="file" accept="application/pdf,image/png,image/jpeg" className="text-sm"
                  disabled={!pdf} onChange={(e) => setSignedFile(e.target.files?.[0] ?? null)}
                />
                {!pdf && <p className="text-xs text-muted-foreground">Generate the PDF first; the signed copy attaches to it.</p>}
                {signed && signedFile && (
                  <Input aria-label="Replacement reason" placeholder="Reason for replacing the signed copy" value={replaceReason} onChange={(e) => setReplaceReason(e.target.value)} />
                )}
                <Button
                  type="button" size="sm" variant="outline"
                  disabled={!pdf || !signedFile || attach.isPending || (!!signed && !replaceReason.trim())}
                  onClick={() => void onAttach()}
                >
                  {attach.isPending ? 'Uploading...' : 'Upload signed copy'}
                </Button>
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Close</Button>
          <Button type="button" disabled={!dn || saving} onClick={() => void save()}>{update.isPending ? 'Saving...' : 'Save Changes'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
