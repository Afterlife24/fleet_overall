import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, ExternalLink, FileText, RefreshCw, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { InfoGrid, InfoRow, SectionTitle } from '@/components/common/InfoGrid';
import { MachineQrPanel } from '@/features/fleet/MachineQrPanel';
import { toastError, toastSuccess } from '@/lib/toast-helper';
import { useCollectionStore } from '@/store/collectionStore';
import { ALLOWED_SIGNED_MIME, collectionStatusControl, type MachineLite } from '@/services/collectionCore';
import { formatGateWhen } from '@/services/gateCore';
import { refreshReferences } from '@/services/collectionDocs';
import { collectionNotePdf, downloadBlob } from '@/services/collectionPdf';
import { attachSigned, getSignedFile } from '@/services/signedFiles';
import type { CollectionNote, CollectionStatus } from '@/types/collection';

interface CollectionDetailProps {
  noteId: string;
  onClose?: () => void;
}

interface FormState {
  status: CollectionStatus;
  date: string;
  collectionAddress: string;
  driver: string;
  vehicle: string;
  remarks: string;
}

function toForm(n: CollectionNote): FormState {
  return {
    status: n.status,
    date: n.date,
    collectionAddress: n.collectionAddress,
    driver: n.driver,
    vehicle: n.vehicle,
    remarks: n.remarks,
  };
}

function machineOf(n: CollectionNote): MachineLite {
  return {
    id: n.machineId,
    orgId: n.orgId,
    fleetNo: n.fleetNo,
    assetNumber: n.fleetNo,
    serialNumber: n.serialNumber,
  };
}

export function CollectionDetail({ noteId, onClose }: CollectionDetailProps) {
  const note = useCollectionStore((s) => s.notes.find((n) => n.id === noteId));
  const [form, setForm] = useState<FormState | null>(note ? toForm(note) : null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Reset the form when switching notes or when stored references change underneath.
  const noteKey = note ? `${note.id}:${note.updatedAt}` : '';
  useEffect(() => {
    setForm(note ? toForm(note) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteKey]);

  const machine = useMemo(() => (note ? machineOf(note) : null), [note]);

  if (!note || !form) {
    return <p className="text-sm text-muted-foreground">Collection note not found.</p>;
  }

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm({ ...form, [k]: v });
  const control = collectionStatusControl(note.status);
  const collectedWhen =
    note.status === 'Collected' && note.collectedByGateRef
      ? formatGateWhen({
          timestamp: note.collectedAt,
          gateTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        })
      : null;
  const dirty = (Object.keys(form) as (keyof FormState)[]).some((k) => form[k] !== note[k]);

  const handleSave = () => {
    try {
      // Collected is set only by Gate-In; never write it from this form.
      const { status, ...rest } = form;
      const safe = status === 'Collected' && note.status !== 'Collected' ? rest : form;
      useCollectionStore.getState().patch(note.id, { ...safe, updatedAt: new Date().toISOString() });
      toastSuccess('Collection note saved');
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const handleRefresh = () => {
    try {
      refreshReferences('CN', note.id);
      toastSuccess('References refreshed');
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Refresh failed');
    }
  };

  const handlePdf = async () => {
    try {
      const blob = await collectionNotePdf(note, machine ?? undefined);
      downloadBlob(blob, `${note.number}.pdf`);
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'PDF generation failed');
    }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setFileError(null);
    setBusy(true);
    try {
      await attachSigned('CN', note.id, file);
      toastSuccess('Signed copy attached');
    } catch (err) {
      setFileError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const handleViewSigned = async () => {
    try {
      const blob = await getSignedFile('CN', note.id);
      if (!blob) {
        toastError('Signed copy not found');
        return;
      }
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Could not open signed copy');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{note.number}</h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="mr-1 h-4 w-4" /> Refresh references
          </Button>
          <Button variant="outline" size="sm" onClick={handlePdf}>
            <Download className="mr-1 h-4 w-4" /> Download PDF
          </Button>
          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          )}
        </div>
      </div>

      <SectionTitle>References</SectionTitle>
      <InfoGrid>
        <InfoRow label="Customer" value={note.customerName || '—'} />
        <InfoRow label="Fleet No" value={note.fleetNo || '—'} />
        <InfoRow label="Machine" value={note.machineDescription || '—'} />
        <InfoRow label="Booking" value={note.bookingRef || '—'} />
        <InfoRow label="Hire Agreement" value={note.hireAgreementNo || '—'} />
        <InfoRow label="Quotation" value={note.quotationNo || '—'} />
        <InfoRow label="Invoice" value={note.invoiceNo || '—'} />
        <InfoRow label="Site" value={note.site || '—'} />
      </InfoGrid>
      {(note.missing.length > 0 || note.refNotes.length > 0) && (
        <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">Missing links: {note.missing.join(', ') || 'none'}</p>
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
          <Label htmlFor="cn-status">Status</Label>
          {control.readOnly && (
            <p>
              <span data-testid="cn-status-badge" className="rounded bg-muted px-2 py-0.5 text-sm font-medium">
                {note.status}
              </span>
            </p>
          )}
          {control.options.length > 0 && (
            <Select
              value={control.options.includes(form.status) ? form.status : undefined}
              onValueChange={(v) => set('status', v as CollectionStatus)}
            >
              <SelectTrigger id="cn-status" aria-label="Status">
                <SelectValue placeholder={control.readOnly ? 'Change status...' : undefined} />
              </SelectTrigger>
              <SelectContent>
                {control.options.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <p className="text-xs text-muted-foreground">Collected is set automatically at Gate-In in Gate Operations</p>
          {collectedWhen && (
            <p className="text-xs" data-testid="cn-collected-at-gate">
              Collected at gate: {note.collectedByGateRef} &middot;{' '}
              {collectedWhen.available ? `${collectedWhen.date} ${collectedWhen.time}` : 'Not available'}{' '}
              <Link className="text-primary underline" to="/gate">
                Open Gate Operations
              </Link>
            </p>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor="cn-date">Collection date</Label>
          <Input id="cn-date" type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="cn-address">Collection address</Label>
          <Input
            id="cn-address"
            value={form.collectionAddress}
            onChange={(e) => set('collectionAddress', e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cn-driver">Driver</Label>
          <Input id="cn-driver" value={form.driver} onChange={(e) => set('driver', e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cn-vehicle">Vehicle</Label>
          <Input id="cn-vehicle" value={form.vehicle} onChange={(e) => set('vehicle', e.target.value)} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="cn-remarks">Remarks</Label>
          <Textarea id="cn-remarks" value={form.remarks} onChange={(e) => set('remarks', e.target.value)} />
        </div>
      </div>
      <div>
        <Button onClick={handleSave} disabled={!dirty}>
          Save
        </Button>
      </div>

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
          Status: <span className="font-medium">{note.signedStatus}</span>
          {note.signedFile ? ` (${note.signedFile.name})` : ''}
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
          <Button variant="outline" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Upload className="mr-1 h-4 w-4" /> {note.signedFile ? 'Replace signed copy' : 'Upload signed copy'}
          </Button>
          {note.signedFile && (
            <Button variant="outline" size="sm" onClick={handleViewSigned}>
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
