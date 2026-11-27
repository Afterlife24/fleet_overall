import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ban, Download, ExternalLink, FileText, RefreshCw, Truck, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { InfoGrid, InfoRow, SectionTitle } from '@/components/common/InfoGrid';
import { ApiErrorNotice, errorText } from '@/components/common/ApiStatus';
import { MachineQrPanel } from '@/features/fleet/MachineQrPanel';
import { toastError, toastSuccess } from '@/lib/toast-helper';
import {
  activeSignedCopy, docSnapshot, fetchCollectionNote, openStoredFile, useAttachSignedCopy, useCancelCollection,
  useCollectionNotes, useMarkPickedUp, useOwnerDocuments, useStoreGeneratedPdf, useUpdateCollectionNote,
} from '@/hooks/api/useCollectionApi';
import { ALLOWED_SIGNED_MIME, validateSignedFile, type MachineLite } from '@/services/collectionCore';
import { formatGateWhen } from '@/services/gateCore';
import { collectionNotePdf, downloadBlob } from '@/services/collectionPdf';
import type { CollectionNote } from '@/types/collection';

interface CollectionDetailProps {
  noteId: string;
  onClose?: () => void;
}

interface FormState {
  collectionDate: string;
  collectionAddress: string;
  driver: string;
  vehicle: string;
  remarks: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
function localDate(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toForm(n: CollectionNote): FormState {
  return {
    collectionDate: localDate(n.scheduledCollectionAt) || n.date,
    collectionAddress: n.collectionAddress,
    driver: n.driver,
    vehicle: n.vehicle,
    remarks: n.remarks,
  };
}

function machineOf(n: CollectionNote): MachineLite {
  return { id: n.machineId, orgId: n.orgId, fleetNo: n.fleetNo, assetNumber: n.fleetNo, serialNumber: n.serialNumber };
}

const EDITABLE = new Set(['Draft', 'Scheduled', 'Picked Up']);

export function CollectionDetail({ noteId, onClose }: CollectionDetailProps) {
  const notesQuery = useCollectionNotes();
  const note = notesQuery.data?.find((n) => n.id === noteId);
  const documents = useOwnerDocuments('collection_note', noteId);
  const signed = activeSignedCopy(documents.data, 'CN');
  const updateNote = useUpdateCollectionNote();
  const markPickedUp = useMarkPickedUp();
  const cancelNote = useCancelCollection();
  const attachSigned = useAttachSignedCopy();
  const storePdf = useStoreGeneratedPdf();

  const [form, setForm] = useState<FormState | null>(note ? toForm(note) : null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [reloading, setReloading] = useState(false);
  const [latestRowVersion, setLatestRowVersion] = useState<number | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // The form is filled when a note is opened; later refreshes never overwrite what is being typed.
  useEffect(() => {
    setForm(note ? toForm(note) : null);
    setError(null);
    setLatestRowVersion(null);
    setCancelling(false);
    setReason('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, !!note]);

  const machine = useMemo(() => (note ? machineOf(note) : null), [note]);

  if (notesQuery.isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (!note || !form) {
    return <p className="text-sm text-muted-foreground">Collection note not found.</p>;
  }

  const rowVersion = Math.max(latestRowVersion ?? 0, note.rowVersion ?? 0);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm({ ...form, [k]: v });
  const original = toForm(note);
  const dirty = (Object.keys(form) as (keyof FormState)[]).some((k) => form[k] !== original[k]);
  const editable = EDITABLE.has(note.status);
  const busy = updateNote.isPending || markPickedUp.isPending || cancelNote.isPending;
  const signedStatus = signed ? 'Signed' : 'Pending';

  const collectedWhen =
    note.status === 'Collected' && note.collectedAt
      ? formatGateWhen({ timestamp: note.collectedAt, gateTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })
      : null;

  const afterWrite = (rv: number) => { setLatestRowVersion(rv); setError(null); };
  const fail = (err: unknown) => { setError(err); toastError(errorText(err)); };

  const reload = async () => {
    setReloading(true);
    try {
      const latest = await fetchCollectionNote(note.id);
      setLatestRowVersion(latest.collectionNote.rowVersion); // entered values are not touched
      await notesQuery.refetch();
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setReloading(false);
    }
  };

  const handleSave = () => {
    const patch: Record<string, unknown> = {};
    if (form.collectionAddress !== original.collectionAddress) patch.collectionAddress = form.collectionAddress.trim();
    if (form.driver !== original.driver) patch.driverName = form.driver.trim();
    if (form.vehicle !== original.vehicle) patch.vehicleText = form.vehicle.trim();
    if (form.remarks !== original.remarks) patch.remarks = form.remarks.trim() || null;
    if (form.collectionDate !== original.collectionDate) {
      patch.scheduledCollectionAt = form.collectionDate ? new Date(`${form.collectionDate}T00:00:00`).toISOString() : null;
    }
    updateNote.mutate(
      { id: note.id, rowVersion, patch },
      { onSuccess: (b) => { afterWrite(b.collectionNote.rowVersion); toastSuccess('Collection note saved'); }, onError: fail },
    );
  };

  const handlePickedUp = () => {
    markPickedUp.mutate(
      { id: note.id, rowVersion },
      { onSuccess: (b) => { afterWrite(b.collectionNote.rowVersion); toastSuccess('Marked picked up'); }, onError: fail },
    );
  };

  const handleCancel = () => {
    if (!reason.trim()) return;
    cancelNote.mutate(
      { id: note.id, rowVersion, reason: reason.trim() },
      {
        onSuccess: (b) => { afterWrite(b.collectionNote.rowVersion); setCancelling(false); setReason(''); toastSuccess('Collection note cancelled'); },
        onError: fail,
      },
    );
  };

  const render = async () => {
    const blob = await collectionNotePdf(note, machine ?? undefined);
    return { blob, snapshot: docSnapshot(note), number: note.number };
  };

  const handlePdf = async () => {
    try {
      const rendered = await render();
      downloadBlob(rendered.blob, `${note.number}.pdf`);
      storePdf.mutate(
        { documentType: 'CN', ownerType: 'collection_note', ownerId: note.id, rendered },
        { onError: (err) => toastError(`The PDF was downloaded but could not be stored: ${errorText(err)}`) },
      );
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'PDF generation failed');
    }
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setFileError(null);
    const v = validateSignedFile({ type: file.type, name: file.name });
    if (!v.ok) { setFileError(v.message); return; }
    if (!['application/pdf', 'image/png', 'image/jpeg'].includes(file.type)) {
      setFileError('Signed copies must be a PDF, PNG or JPEG file.');
      return;
    }
    attachSigned.mutate(
      { documentType: 'CN', ownerType: 'collection_note', ownerId: note.id, file, render },
      {
        onSuccess: () => toastSuccess('Signed copy attached'),
        onError: (err) => setFileError(errorText(err)),
      },
    );
  };

  const handleViewSigned = async () => {
    if (!signed) return;
    try {
      await openStoredFile(signed.fileId);
    } catch (err) {
      toastError(errorText(err));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{note.number}</h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void notesQuery.refetch()}>
            <RefreshCw className="mr-1 h-4 w-4" /> Refresh references
          </Button>
          <Button variant="outline" size="sm" onClick={() => void handlePdf()}>
            <Download className="mr-1 h-4 w-4" /> Download PDF
          </Button>
          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          )}
        </div>
      </div>

      {error != null && <ApiErrorNotice error={error} onReload={() => void reload()} reloading={reloading} />}

      <SectionTitle>References</SectionTitle>
      <InfoGrid>
        <InfoRow label="Customer" value={note.customerName || '—'} />
        <InfoRow label="Fleet No" value={note.fleetNo || '—'} />
        <InfoRow label="Machine" value={note.machineDescription || '—'} />
        <InfoRow label="Booking" value={note.bookingRef || '—'} />
        <InfoRow label="Hire Agreement" value={note.hireAgreementNo || '—'} />
        <InfoRow label="Invoice" value={note.invoiceNo || '—'} />
        <InfoRow label="Site" value={note.site || '—'} />
      </InfoGrid>
      {note.missing.length > 0 && (
        <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">Missing links: {note.missing.join(', ')}</p>
          <ul className="list-disc pl-5">
            {note.refNotes.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      <SectionTitle>Collection details</SectionTitle>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Status</Label>
          <p>
            <span data-testid="cn-status-badge" className="rounded bg-muted px-2 py-0.5 text-sm font-medium">
              {note.status}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            Picked Up records the truck pickup only. Collected is set automatically at Gate-In in Gate Operations.
          </p>
          {note.pickedUpAt && note.status !== 'Draft' && note.status !== 'Scheduled' && (
            <p className="text-xs" data-testid="cn-picked-up-at">Picked up: {new Date(note.pickedUpAt).toLocaleString()}</p>
          )}
          {collectedWhen && (
            <p className="text-xs" data-testid="cn-collected-at-gate">
              Collected at gate: {collectedWhen.available ? `${collectedWhen.date} ${collectedWhen.time}` : 'Not available'}{' '}
              <Link className="text-primary underline" to="/gate">
                Open Gate Operations
              </Link>
            </p>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor="cn-date">Collection date</Label>
          <Input id="cn-date" type="date" value={form.collectionDate} disabled={!editable} onChange={(e) => set('collectionDate', e.target.value)} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="cn-address">Collection address</Label>
          <Input id="cn-address" value={form.collectionAddress} disabled={!editable} onChange={(e) => set('collectionAddress', e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cn-driver">Driver</Label>
          <Input id="cn-driver" value={form.driver} disabled={!editable} onChange={(e) => set('driver', e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cn-vehicle">Vehicle</Label>
          <Input id="cn-vehicle" value={form.vehicle} disabled={!editable} onChange={(e) => set('vehicle', e.target.value)} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="cn-remarks">Remarks</Label>
          <Textarea id="cn-remarks" value={form.remarks} disabled={!editable} onChange={(e) => set('remarks', e.target.value)} />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={handleSave} disabled={!dirty || !editable || busy}>
          {updateNote.isPending ? 'Saving...' : 'Save'}
        </Button>
        {(note.status === 'Draft' || note.status === 'Scheduled') && (
          <Button variant="outline" onClick={handlePickedUp} disabled={busy}>
            <Truck className="mr-1 h-4 w-4" /> Mark Picked Up
          </Button>
        )}
        {EDITABLE.has(note.status) && !cancelling && (
          <Button variant="outline" onClick={() => setCancelling(true)} disabled={busy}>
            <Ban className="mr-1 h-4 w-4" /> Cancel collection
          </Button>
        )}
      </div>
      {cancelling && (
        <div className="space-y-2 rounded-md border border-border p-3">
          <Label htmlFor="cn-cancel-reason">Reason for cancelling</Label>
          <Input id="cn-cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this collection cancelled?" />
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" onClick={handleCancel} disabled={!reason.trim() || busy}>
              {cancelNote.isPending ? 'Cancelling...' : 'Confirm cancel'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setCancelling(false); setReason(''); }} disabled={busy}>
              Keep collection
            </Button>
          </div>
        </div>
      )}

      <SectionTitle>Linked documents</SectionTitle>
      <ul className="space-y-1 text-sm">
        <li className="flex items-center gap-2">
          <FileText className="h-4 w-4" />
          {note.mqdId ? (
            <Link className="text-primary underline" to={`/mqd?id=${note.mqdId}`}>
              MQD <ExternalLink className="inline h-3 w-3" />
            </Link>
          ) : (
            <span className="text-muted-foreground">No MQD linked</span>
          )}
        </li>
        <li className="flex items-center gap-2">
          <FileText className="h-4 w-4" />
          {note.tpsId ? (
            <Link className="text-primary underline" to={`/docs/third-party-services?id=${note.tpsId}`}>
              Third-Party Services <ExternalLink className="inline h-3 w-3" />
            </Link>
          ) : (
            <span className="text-muted-foreground">No Third-Party Services document linked</span>
          )}
        </li>
      </ul>

      <SectionTitle>Signed copy</SectionTitle>
      <div className="space-y-2 text-sm">
        <p>
          Status: <span className="font-medium">{signedStatus}</span>
          {signed ? ` (${signed.originalName})` : ''}
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept={ALLOWED_SIGNED_MIME.join(',')}
            onChange={handleFile}
            aria-label="Signed copy file"
          />
          <Button variant="outline" size="sm" disabled={attachSigned.isPending} onClick={() => fileRef.current?.click()}>
            <Upload className="mr-1 h-4 w-4" /> {attachSigned.isPending ? 'Uploading...' : signed ? 'Replace signed copy' : 'Upload signed copy'}
          </Button>
          {signed && (
            <Button variant="outline" size="sm" onClick={() => void handleViewSigned()}>
              View signed copy
            </Button>
          )}
        </div>
        {fileError && (
          <p role="alert" className="text-destructive">
            {fileError}
          </p>
        )}
      </div>

      {machine && (
        <>
          <SectionTitle>Machine QR</SectionTitle>
          <div className="max-w-xs">
            <MachineQrPanel machine={machine} />
          </div>
        </>
      )}
    </div>
  );
}

export default CollectionDetail;
