import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Plus, Upload } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { SlideOver } from '@/components/common/SlideOver';
import { InfoGrid, InfoRow, SectionTitle } from '@/components/common/InfoGrid';
import { LoadingState } from '@/components/common/EmptyState';
import { ApiErrorNotice, ApiSessionGate, errorText } from '@/components/common/ApiStatus';
import { DataTable, type Column } from '@/components/tables/DataTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ServiceLineTable } from '@/features/thirdparty/ServiceLineTable';
import { toastError, toastSuccess } from '@/lib/toast-helper';
import { formatCurrency } from '@/utils/format';
import { useSubmission } from '@/hooks/useApiResources';
import {
  activeSignedCopy, docSnapshot, documentTypeFor, fetchServiceReport, openStoredFile, ownerTypeFor, useAttachSignedCopy,
  useCollectionWorld, useCreateServiceReport, useOwnerDocuments, useStoreGeneratedPdf, useUpdateServiceReport,
} from '@/hooks/api/useCollectionApi';
import type { ReportPhase } from '@/services/api/documents';
import { ALLOWED_SIGNED_MIME, tpsTotal, validateServiceLine, validateSignedFile } from '@/services/collectionCore';
import { downloadBlob, tpsPdf } from '@/services/collectionPdf';
import type { ServiceLine, TpsDocument } from '@/types/collection';

interface FormState {
  notes: string;
  approvedBy: string;
  signature: string;
  lines: ServiceLine[];
}

function toForm(d: TpsDocument): FormState {
  return { notes: d.notes, approvedBy: d.approvedBy, signature: d.signature, lines: d.lines };
}

const phaseLabel = (p: ReportPhase | undefined) => (p === 'HIRE' ? 'Hire' : 'Collection');

function TpsDetail({ docId, onClose }: { docId: string; onClose: () => void }) {
  const world = useCollectionWorld();
  const doc = world.data?.tps.find((d) => d.id === docId);
  const cnNumber = doc?.cnId ? world.data?.notes.find((n) => n.id === doc.cnId)?.number ?? '' : '';
  const documents = useOwnerDocuments('service_report', docId);
  const documentType = documentTypeFor('TPS', doc?.phase);
  const signed = activeSignedCopy(documents.data, documentType);
  const updateReport = useUpdateServiceReport();
  const attachSigned = useAttachSignedCopy();
  const storePdf = useStoreGeneratedPdf();
  const [form, setForm] = useState<FormState | null>(doc ? toForm(doc) : null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [reloading, setReloading] = useState(false);
  const [latestRowVersion, setLatestRowVersion] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // The form is filled when a document is opened; later refreshes never overwrite what is being typed.
  useEffect(() => {
    setForm(doc ? toForm(doc) : null);
    setError(null);
    setLatestRowVersion(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, !!doc]);

  if (world.isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (!doc || !form) return <p className="text-sm text-muted-foreground">Document not found.</p>;

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm({ ...form, [k]: v });
  const original = toForm(doc);
  const dirty = (Object.keys(form) as (keyof FormState)[]).some((k) => form[k] !== original[k]);
  const rowVersion = Math.max(latestRowVersion ?? 0, doc.rowVersion ?? 0);

  const reload = async () => {
    setReloading(true);
    try {
      setLatestRowVersion((await fetchServiceReport(doc.id)).rowVersion); // entered values are not touched
      await world.refetch();
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setReloading(false);
    }
  };

  const handleSave = () => {
    const bad = form.lines.find((l) => !validateServiceLine(l).ok);
    if (bad) {
      const res = validateServiceLine(bad);
      toastError(res.ok ? 'Invalid service line' : res.message);
      return;
    }
    updateReport.mutate(
      {
        id: doc.id,
        rowVersion,
        patch: {
          notes: form.notes.trim() || null,
          approvedName: form.approvedBy.trim() || null,
          signatureText: form.signature.trim() || null,
          lines: form.lines.map((l) => ({
            provider: l.provider,
            serviceType: l.serviceType,
            description: l.description,
            serviceDate: l.date,
            externalReference: l.reference,
            quantity: String(l.quantity),
            rate: String(l.rate),
          })),
        },
      },
      {
        onSuccess: (dto) => { setLatestRowVersion(dto.rowVersion); setError(null); toastSuccess('Document saved'); },
        onError: (err) => { setError(err); toastError(errorText(err)); },
      },
    );
  };

  const render = async () => {
    const current: TpsDocument = { ...doc, ...form, approvedBy: form.approvedBy, signature: form.signature };
    return { blob: await tpsPdf(current), snapshot: docSnapshot(current), number: doc.number };
  };

  const handlePdf = async () => {
    try {
      const rendered = await render();
      downloadBlob(rendered.blob, `${doc.number}.pdf`);
      storePdf.mutate(
        { documentType, ownerType: ownerTypeFor('TPS'), ownerId: doc.id, rendered },
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
      { documentType, ownerType: ownerTypeFor('TPS'), ownerId: doc.id, file, render },
      { onSuccess: () => toastSuccess('Signed copy attached'), onError: (err) => setFileError(errorText(err)) },
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
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => void handlePdf()}>
          <Download className="mr-1 h-4 w-4" /> Download PDF
        </Button>
      </div>
      {error != null && <ApiErrorNotice error={error} onReload={() => void reload()} reloading={reloading} />}
      <SectionTitle>References</SectionTitle>
      <InfoGrid>
        <InfoRow label="Phase" value={`${phaseLabel(doc.phase)} (${documentType})`} />
        <InfoRow label="Collection note" value={cnNumber || '—'} />
        <InfoRow label="Customer" value={doc.customerName || '—'} />
        <InfoRow label="Fleet No" value={doc.fleetNo || '—'} />
        <InfoRow label="Machine" value={doc.machineDescription || '—'} />
        <InfoRow label="Booking" value={doc.bookingRef || '—'} />
        <InfoRow label="Hire Agreement" value={doc.hireAgreementNo || '—'} />
        <InfoRow label="Site" value={doc.site || '—'} />
      </InfoGrid>
      <SectionTitle>Service lines</SectionTitle>
      <ServiceLineTable lines={form.lines} onChange={(lines) => set('lines', lines)} />
      <p className="text-right text-sm font-semibold">Total: {formatCurrency(tpsTotal(form.lines))}</p>
      <SectionTitle>Approval</SectionTitle>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="tps-approvedBy">Approved by</Label>
          <Input id="tps-approvedBy" value={form.approvedBy} onChange={(e) => set('approvedBy', e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="tps-signature">Signature</Label>
          <Input id="tps-signature" value={form.signature} onChange={(e) => set('signature', e.target.value)} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="tps-notes">Notes</Label>
          <Textarea id="tps-notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
      </div>
      <div>
        <Button onClick={handleSave} disabled={!dirty || updateReport.isPending}>
          {updateReport.isPending ? 'Saving...' : 'Save'}
        </Button>
      </div>
      <SectionTitle>Signed copy</SectionTitle>
      <div className="space-y-2 text-sm">
        <p>
          Status: <span className="font-medium">{signed ? 'Signed' : 'Pending'}</span>
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
      <div>
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}

function NewDocumentDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const world = useCollectionWorld();
  const bookings = useMemo(() => world.data?.bookings ?? [], [world.data]);
  const notes = useMemo(() => world.data?.notes ?? [], [world.data]);
  const create = useCreateServiceReport();
  const submission = useSubmission();
  const [bookingId, setBookingId] = useState('');
  const [phase, setPhase] = useState<ReportPhase>('HIRE');
  const [collectionNoteId, setCollectionNoteId] = useState('');
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!open) return;
    setBookingId('');
    setPhase('HIRE');
    setCollectionNoteId('');
    setError(null);
  }, [open]);

  const noteOptions = notes.filter((n) => n.bookingId === bookingId && n.status !== 'Cancelled');
  const canCreate = !!bookingId && (phase === 'HIRE' || !!collectionNoteId) && !create.isPending;

  const submit = () => {
    setError(null);
    create.mutate(
      {
        body: { bookingId, phase, ...(phase === 'COLLECTION' ? { collectionNoteId } : {}) },
        submissionId: submission.id(),
      },
      {
        onSuccess: (dto) => { submission.renew(); toastSuccess(`Created ${dto.number}`); onCreated(dto.id); onClose(); },
        onError: (err) => setError(err),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Third-Party Services document</DialogTitle>
          <DialogDescription>
            Hire reports are numbered HTPS and collection reports TPS. A collection report is created with the collection note; one more only exists if the server allows it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="tps-new-phase">Phase</Label>
            <Select value={phase} onValueChange={(v) => { setPhase(v as ReportPhase); setCollectionNoteId(''); }}>
              <SelectTrigger id="tps-new-phase"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="HIRE">Hire (HTPS)</SelectItem>
                <SelectItem value="COLLECTION">Collection (TPS)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="tps-new-booking">Booking</Label>
            <Select value={bookingId} onValueChange={(v) => { setBookingId(v); setCollectionNoteId(''); }}>
              <SelectTrigger id="tps-new-booking"><SelectValue placeholder="Select booking" /></SelectTrigger>
              <SelectContent>
                {bookings.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.reference} · {b.fleetNo || b.assetNo} · {b.customerName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {phase === 'COLLECTION' && (
            <div className="space-y-1">
              <Label htmlFor="tps-new-cn">Collection note</Label>
              <Select value={collectionNoteId} onValueChange={setCollectionNoteId}>
                <SelectTrigger id="tps-new-cn"><SelectValue placeholder="Select collection note" /></SelectTrigger>
                <SelectContent>
                  {noteOptions.map((n) => (
                    <SelectItem key={n.id} value={n.id}>{n.number}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        {error != null && <ApiErrorNotice error={error} />}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!canCreate}>{create.isPending ? 'Creating...' : 'Create'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ThirdPartyServicesPage() {
  return (
    <ApiSessionGate>
      <ThirdPartyServices />
    </ApiSessionGate>
  );
}

function ThirdPartyServices() {
  const world = useCollectionWorld();
  const docs = useMemo(() => world.data?.tps ?? [], [world.data]);
  const cnNotes = useMemo(() => world.data?.notes ?? [], [world.data]);
  const [params, setParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(params.get('id'));
  const [newOpen, setNewOpen] = useState(false);

  useEffect(() => {
    const id = params.get('id');
    if (id) setSelectedId(id);
  }, [params]);

  const close = () => {
    setSelectedId(null);
    if (params.has('id')) {
      const next = new URLSearchParams(params);
      next.delete('id');
      setParams(next, { replace: true });
    }
  };

  const cnNumber = (d: TpsDocument) => (d.cnId ? cnNotes.find((n) => n.id === d.cnId)?.number ?? '' : '');

  const columns: Column<TpsDocument>[] = [
    { key: 'number', header: 'Number', sortable: true, sortAccessor: (d) => d.number, render: (d) => <span className="font-medium">{d.number}</span> },
    { key: 'phase', header: 'Phase', sortable: true, sortAccessor: (d) => d.phase ?? '', render: (d) => phaseLabel(d.phase) },
    { key: 'cn', header: 'Collection Note', sortable: true, sortAccessor: cnNumber, render: (d) => cnNumber(d) || '—' },
    { key: 'fleetNo', header: 'Fleet No', sortable: true, sortAccessor: (d) => d.fleetNo, render: (d) => d.fleetNo || '—' },
    { key: 'customerName', header: 'Customer', sortable: true, sortAccessor: (d) => d.customerName, render: (d) => d.customerName || '—' },
    { key: 'total', header: 'Total', sortable: true, sortAccessor: (d) => tpsTotal(d.lines), render: (d) => formatCurrency(tpsTotal(d.lines)) },
  ];

  if (world.isLoading) return <LoadingState />;
  if (world.isError) return <ApiErrorNotice error={world.error} onRetry={() => void world.refetch()} />;

  const selected = selectedId ? docs.find((d) => d.id === selectedId) : undefined;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Third-Party Services"
        description="Third-party service charges raised against hire and off-hire collections"
        actions={
          <Button onClick={() => setNewOpen(true)}>
            <Plus className="mr-1 h-4 w-4" /> New document
          </Button>
        }
      />
      <DataTable
        columns={columns}
        data={docs}
        searchable
        searchKeys={['number', 'fleetNo', 'customerName']}
        initialSort={{ key: 'number', direction: 'desc' }}
        rowKey={(d) => d.id}
        onRowClick={(d) => setSelectedId(d.id)}
        emptyMessage="No third-party services documents yet."
      />
      <SlideOver
        open={!!selectedId}
        onClose={close}
        title={selected?.number ?? 'Third-Party Services'}
        width="xl"
      >
        {selectedId && <TpsDetail docId={selectedId} onClose={close} />}
      </SlideOver>
      <NewDocumentDialog open={newOpen} onClose={() => setNewOpen(false)} onCreated={(id) => setSelectedId(id)} />
    </div>
  );
}

export default ThirdPartyServicesPage;
