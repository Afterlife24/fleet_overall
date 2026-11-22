import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Plus, Trash2, Upload } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { SlideOver } from '@/components/common/SlideOver';
import { SectionTitle } from '@/components/common/InfoGrid';
import { DataTable, type Column } from '@/components/tables/DataTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ServiceLineTable } from '@/features/thirdparty/ServiceLineTable';
import { toastError, toastSuccess } from '@/lib/toast-helper';
import { formatCurrency } from '@/utils/format';
import { JA_ORG_ID, useAuthStore } from '@/store/authStore';
import { useCollectionStore } from '@/store/collectionStore';
import { useThirdPartyStore } from '@/store/thirdPartyStore';
import { ALLOWED_SIGNED_MIME, tpsTotal, validateServiceLine } from '@/services/collectionCore';
import { deleteDocument, useThirdPartyDocs } from '@/services/collectionDocs';
import { downloadBlob, tpsPdf } from '@/services/collectionPdf';
import { attachSigned, getSignedFile } from '@/services/signedFiles';
import type { ServiceLine, SignedStatus, TpsDocument } from '@/types/collection';

interface FormState {
  cnId: string;
  customerName: string;
  fleetNo: string;
  machineDescription: string;
  serialNumber: string;
  bookingRef: string;
  quotationNo: string;
  invoiceNo: string;
  hireAgreementNo: string;
  site: string;
  signedStatus: SignedStatus;
  notes: string;
  approvedBy: string;
  signature: string;
  lines: ServiceLine[];
}

function toForm(d: TpsDocument): FormState {
  return {
    cnId: d.cnId ?? '',
    customerName: d.customerName,
    fleetNo: d.fleetNo,
    machineDescription: d.machineDescription,
    serialNumber: d.serialNumber,
    bookingRef: d.bookingRef,
    quotationNo: d.quotationNo,
    invoiceNo: d.invoiceNo,
    hireAgreementNo: d.hireAgreementNo,
    site: d.site,
    signedStatus: d.signedStatus,
    notes: d.notes,
    approvedBy: d.approvedBy,
    signature: d.signature,
    lines: d.lines,
  };
}

const TEXT_FIELDS: { key: keyof FormState; label: string }[] = [
  { key: 'customerName', label: 'Customer' },
  { key: 'fleetNo', label: 'Fleet No' },
  { key: 'machineDescription', label: 'Machine' },
  { key: 'serialNumber', label: 'Serial number' },
  { key: 'bookingRef', label: 'Booking' },
  { key: 'hireAgreementNo', label: 'Hire Agreement' },
  { key: 'quotationNo', label: 'Quotation' },
  { key: 'invoiceNo', label: 'Invoice' },
  { key: 'site', label: 'Site' },
];

const selectCls =
  'h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

function TpsDetail({ docId, onClose }: { docId: string; onClose: () => void }) {
  const doc = useThirdPartyStore((s) => s.documents.find((d) => d.id === docId));
  const notes = useCollectionStore((s) => s.notes);
  const [form, setForm] = useState<FormState | null>(doc ? toForm(doc) : null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const docKey = doc ? `${doc.id}:${doc.updatedAt}` : '';
  useEffect(() => {
    setForm(doc ? toForm(doc) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

  if (!doc || !form) return <p className="text-sm text-muted-foreground">Document not found.</p>;

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm({ ...form, [k]: v });
  const dirty = (Object.keys(form) as (keyof FormState)[]).some((k) =>
    k === 'cnId' ? form.cnId !== (doc.cnId ?? '') : form[k] !== doc[k as keyof TpsDocument],
  );
  const orgNotes = notes.filter((n) => n.orgId === doc.orgId);

  const handleSave = () => {
    const bad = form.lines.find((l) => !validateServiceLine(l).ok);
    if (bad) {
      const res = validateServiceLine(bad);
      toastError(res.ok ? 'Invalid service line' : res.message);
      return;
    }
    try {
      const { cnId, ...rest } = form;
      useThirdPartyStore.getState().patch(doc.id, {
        ...rest,
        cnId: cnId || undefined,
        updatedAt: new Date().toISOString(),
      });
      toastSuccess('Document saved');
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const handlePdf = async () => {
    try {
      const blob = await tpsPdf({ ...doc, ...form, cnId: form.cnId || undefined });
      downloadBlob(blob, `${doc.number}.pdf`);
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'PDF generation failed');
    }
  };

  const handleDelete = () => {
    if (!window.confirm(`Delete ${doc.number}? This cannot be undone.`)) return;
    try {
      deleteDocument('TPS', doc.id);
      toastSuccess('Document deleted');
      onClose();
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setFileError(null);
    setBusy(true);
    try {
      await attachSigned('TPS', doc.id, file);
      toastSuccess('Signed copy attached');
    } catch (err) {
      setFileError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const handleViewSigned = async () => {
    try {
      const blob = await getSignedFile('TPS', doc.id);
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
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" onClick={handlePdf}>
          <Download className="mr-1 h-4 w-4" /> Download PDF
        </Button>
        <Button variant="outline" size="sm" onClick={handleDelete}>
          <Trash2 className="mr-1 h-4 w-4" /> Delete
        </Button>
      </div>

      <SectionTitle>References</SectionTitle>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="tps-cn">Collection note</Label>
          <select
            id="tps-cn"
            className={selectCls}
            value={form.cnId}
            onChange={(e) => set('cnId', e.target.value)}
          >
            <option value="">— None —</option>
            {orgNotes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.number}
              </option>
            ))}
          </select>
        </div>
        {TEXT_FIELDS.map((f) => (
          <div key={f.key} className="space-y-1">
            <Label htmlFor={`tps-${f.key}`}>{f.label}</Label>
            <Input
              id={`tps-${f.key}`}
              value={form[f.key] as string}
              onChange={(e) => set(f.key, e.target.value as never)}
            />
          </div>
        ))}
        <div className="space-y-1">
          <Label htmlFor="tps-created">Date</Label>
          <Input id="tps-created" type="date" value={doc.createdAt.slice(0, 10)} disabled />
        </div>
      </div>

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
        <div className="space-y-1">
          <Label htmlFor="tps-signed">Signed status</Label>
          <select
            id="tps-signed"
            className={selectCls}
            value={form.signedStatus}
            onChange={(e) => set('signedStatus', e.target.value as SignedStatus)}
          >
            <option value="Pending">Pending</option>
            <option value="Signed">Signed</option>
          </select>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="tps-notes">Notes</Label>
          <Textarea id="tps-notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
      </div>
      <div>
        <Button onClick={handleSave} disabled={!dirty}>
          Save
        </Button>
      </div>

      <SectionTitle>Signed copy</SectionTitle>
      <div className="space-y-2 text-sm">
        <p>
          Status: <span className="font-medium">{doc.signedStatus}</span>
          {doc.signedFile ? ` (${doc.signedFile.name})` : ''}
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
            <Upload className="mr-1 h-4 w-4" /> {doc.signedFile ? 'Replace signed copy' : 'Upload signed copy'}
          </Button>
          {doc.signedFile && (
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
    </div>
  );
}

export function ThirdPartyServicesPage() {
  const docs = useThirdPartyDocs();
  const orgId = useAuthStore((s) => s.user?.orgId ?? JA_ORG_ID);
  const cnNotes = useCollectionStore((s) => s.notes);
  const [params, setParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(params.get('id'));

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

  const handleNew = () => {
    try {
      const store = useThirdPartyStore.getState();
      const now = new Date();
      const iso = now.toISOString();
      const id = store.newId();
      const doc: TpsDocument = {
        id,
        orgId,
        number: store.issueNumber(orgId, now.getFullYear()),
        machineId: '',
        fleetNo: '',
        machineDescription: '',
        serialNumber: '',
        customerName: '',
        customerId: '',
        bookingId: '',
        bookingRef: '',
        hireAgreementId: '',
        hireAgreementNo: '',
        quotationId: '',
        quotationNo: '',
        invoiceId: '',
        invoiceNo: '',
        site: '',
        missing: [],
        refNotes: [],
        signedStatus: 'Pending',
        lines: [],
        notes: '',
        approvedBy: '',
        signature: '',
        createdAt: iso,
        updatedAt: iso,
      };
      store.insert(doc);
      setSelectedId(id);
      toastSuccess(`Created ${doc.number}`);
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Could not create document');
    }
  };

  const columns: Column<TpsDocument>[] = [
    { key: 'number', header: 'Number', sortable: true, sortAccessor: (d) => d.number, render: (d) => <span className="font-medium">{d.number}</span> },
    { key: 'cn', header: 'Collection Note', sortable: true, sortAccessor: cnNumber, render: (d) => cnNumber(d) || '—' },
    { key: 'fleetNo', header: 'Fleet No', sortable: true, sortAccessor: (d) => d.fleetNo, render: (d) => d.fleetNo || '—' },
    { key: 'customerName', header: 'Customer', sortable: true, sortAccessor: (d) => d.customerName, render: (d) => d.customerName || '—' },
    { key: 'total', header: 'Total', sortable: true, sortAccessor: (d) => tpsTotal(d.lines), render: (d) => formatCurrency(tpsTotal(d.lines)) },
    { key: 'signedStatus', header: 'Signed', sortable: true, sortAccessor: (d) => d.signedStatus, render: (d) => d.signedStatus },
  ];

  const selected = selectedId ? docs.find((d) => d.id === selectedId) : undefined;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Third-Party Services"
        description="Third-party service charges raised against off-hire collections"
        actions={
          <Button onClick={handleNew}>
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
    </div>
  );
}

export default ThirdPartyServicesPage;
