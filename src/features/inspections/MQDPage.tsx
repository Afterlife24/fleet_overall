import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusBadge } from '@/components/common/StatusBadge';
import { LoadingState } from '@/components/common/EmptyState';
import { ApiErrorNotice, ApiSessionGate, errorText } from '@/components/common/ApiStatus';
import { DataTable, type Column } from '@/components/tables/DataTable';
import { Button } from '@/components/ui/button';
import { toastError, toastSuccess } from '@/lib/toast-helper';
import {
  docSnapshot, documentTypeFor, openSignedCopy, ownerTypeFor, useAttachSignedCopy, useCollectionWorld,
  useStoreGeneratedPdf,
} from '@/hooks/api/useCollectionApi';
import { ALLOWED_SIGNED_MIME, validateSignedFile } from '@/services/collectionCore';
import { downloadBlob, mqdPdf } from '@/services/collectionPdf';
import type { MqdRecord } from '@/types/collection';
import { MQDDialog } from './MQDDialog';

export function MQDPage() {
  return (
    <ApiSessionGate>
      <MqdReports />
    </ApiSessionGate>
  );
}

interface Row {
  id: string;
  record: MqdRecord;
  reference: string;
  phase: string;
  fleetNo: string;
  hirer: string;
  collectionNo: string;
  date: string;
}

function MqdReports() {
  const world = useCollectionWorld();
  const [params, setParams] = useSearchParams();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MqdRecord | undefined>(undefined);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<MqdRecord | null>(null);
  const attachSigned = useAttachSignedCopy();
  const storePdf = useStoreGeneratedPdf();

  const records = useMemo(() => world.data?.mqds ?? [], [world.data]);
  const notes = useMemo(() => world.data?.notes ?? [], [world.data]);
  const rows = useMemo<Row[]>(
    () => records.map((r) => ({
      id: r.id,
      record: r,
      reference: r.number,
      phase: r.phase === 'HIRE' ? 'Hire' : 'Collection',
      fleetNo: r.fleetNo,
      hirer: r.hirer,
      collectionNo: (r.cnId ? notes.find((n) => n.id === r.cnId)?.number : undefined) ?? '',
      date: r.date,
    })),
    [records, notes],
  );

  const idParam = params.get('id');
  useEffect(() => {
    if (!idParam) return;
    const rec = records.find((r) => r.id === idParam);
    if (rec) {
      setEditing(rec);
      setDialogOpen(true);
    }
  }, [idParam, records]);

  const closeDialog = () => {
    setDialogOpen(false);
    setEditing(undefined);
    if (params.has('id')) {
      const next = new URLSearchParams(params);
      next.delete('id');
      setParams(next, { replace: true });
    }
  };

  const render = (rec: MqdRecord) => async () => ({
    blob: await mqdPdf(rec),
    snapshot: docSnapshot(rec),
    number: rec.number,
  });

  const download = async (rec: MqdRecord) => {
    try {
      const rendered = await render(rec)();
      downloadBlob(rendered.blob, `${rec.number}.pdf`);
      storePdf.mutate(
        { documentType: documentTypeFor('MQD', rec.phase), ownerType: ownerTypeFor('MQD'), ownerId: rec.id, rendered },
        { onError: (err) => toastError(`The PDF was downloaded but could not be stored: ${errorText(err)}`) },
      );
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'PDF generation failed');
    }
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const rec = uploadTarget.current;
    e.target.value = '';
    if (!file || !rec) return;
    setFileError(null);
    const v = validateSignedFile({ type: file.type, name: file.name });
    if (!v.ok || !['application/pdf', 'image/png', 'image/jpeg'].includes(file.type)) {
      const msg = v.ok ? 'Signed copies must be a PDF, PNG or JPEG file.' : v.message;
      setFileError(msg);
      toastError(msg);
      return;
    }
    attachSigned.mutate(
      { documentType: documentTypeFor('MQD', rec.phase), ownerType: ownerTypeFor('MQD'), ownerId: rec.id, file, render: render(rec) },
      {
        onSuccess: () => toastSuccess('Signed copy attached'),
        onError: (err) => { setFileError(errorText(err)); toastError(errorText(err)); },
      },
    );
  };

  const viewSigned = async (rec: MqdRecord) => {
    try {
      if (!(await openSignedCopy(ownerTypeFor('MQD'), rec.id, documentTypeFor('MQD', rec.phase)))) {
        toastError('No signed copy has been attached yet');
      }
    } catch (err) {
      toastError(errorText(err));
    }
  };

  const columns: Column<Row>[] = [
    { key: 'reference', header: 'Reference', sortable: true, sortAccessor: (r) => r.reference, render: (r) => <span className="font-medium text-foreground">{r.reference}</span> },
    { key: 'phase', header: 'Phase', sortable: true, sortAccessor: (r) => r.phase, render: (r) => <StatusBadge status={r.phase} size="sm" /> },
    { key: 'fleetNo', header: 'Fleet No', sortable: true, sortAccessor: (r) => r.fleetNo, render: (r) => <span className="text-foreground">{r.fleetNo || '—'}</span> },
    { key: 'hirer', header: 'Hirer', sortable: true, sortAccessor: (r) => r.hirer, render: (r) => <span className="text-muted-foreground">{r.hirer || '—'}</span> },
    { key: 'collectionNo', header: 'Collection Note', sortable: true, sortAccessor: (r) => r.collectionNo, render: (r) => <span className="text-muted-foreground">{r.collectionNo || '—'}</span> },
    { key: 'date', header: 'Date', sortable: true, sortAccessor: (r) => r.date, render: (r) => r.date },
    {
      key: 'actions', header: 'Actions',
      render: (r) => (
        <div className="flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="outline" size="sm" onClick={() => { setEditing(r.record); setDialogOpen(true); }}>Edit</Button>
          <Button variant="outline" size="sm" onClick={() => void download(r.record)}>Download MQD PDF</Button>
          <Button
            variant="outline" size="sm" disabled={attachSigned.isPending}
            onClick={() => { uploadTarget.current = r.record; fileRef.current?.click(); }}
          >
            Upload signed copy
          </Button>
          <Button variant="outline" size="sm" onClick={() => void viewSigned(r.record)}>View signed copy</Button>
        </div>
      ),
    },
  ];

  if (world.isLoading) return <LoadingState />;
  if (world.isError) return <ApiErrorNotice error={world.error} onRetry={() => void world.refetch()} />;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Machine Quality Document"
        description="Condition records at delivery (hire) and return (collection)"
        actions={
          <Button size="sm" onClick={() => { setEditing(undefined); setDialogOpen(true); }}>
            <Plus className="mr-1.5 h-4 w-4" /> New MQD
          </Button>
        }
      />
      {fileError && <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{fileError}</p>}
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        accept={ALLOWED_SIGNED_MIME.join(',')}
        onChange={handleFile}
        aria-label="Signed copy file"
      />
      <DataTable
        columns={columns}
        data={rows}
        searchable
        searchPlaceholder="Search by reference, fleet no, hirer..."
        searchKeys={['reference', 'fleetNo', 'hirer', 'collectionNo']}
        onRowClick={(r) => { setEditing(r.record); setDialogOpen(true); }}
        rowKey={(r) => r.id}
        pageSize={12}
        emptyMessage="No MQD reports yet."
      />
      <MQDDialog open={dialogOpen} onClose={closeDialog} record={editing} />
    </div>
  );
}
