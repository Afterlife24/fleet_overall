import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { DataTable, type Column } from '@/components/tables/DataTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LoadingState } from '@/components/common/EmptyState';
import { ApiErrorNotice, ApiSessionGate, describeApiError } from '@/components/common/ApiStatus';
import {
  fetchLpo, uploadLpoFile, useCreateLpo, useCrmData, useLpos, useSubmission, useUpdateLpo,
} from '@/hooks/useApiResources';
import { filesApi } from '@/services/api/files';
import type { CustomerLpoDto } from '../../../shared/dto/index';
import { formatCurrency } from '@/utils/format';
import { toastSuccess } from '@/lib/toast-helper';

const SCAN_POLLS = 5;
const SCAN_WAIT_MS = 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Customer LPO page. Lists, creates and edits LPOs through `/api/v1/customer-lpos`; waits for the API session. */
export function LpoPage() {
  return (
    <ApiSessionGate>
      <LpoScreen />
    </ApiSessionGate>
  );
}

function LpoScreen() {
  const lpos = useLpos();
  const crm = useCrmData();
  const [editing, setEditing] = useState<CustomerLpoDto | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const quotationNo = new Map((crm.data?.quotations ?? []).map((q) => [q.id, q.number]));
  const customerName = new Map((crm.data?.quotations ?? []).map((q) => [q.id, q.customerName]));

  const columns: Column<CustomerLpoDto>[] = [
    { key: 'lpoNo', header: 'LPO No.', sortable: true, render: (r) => <span className="font-mono text-xs font-semibold">{r.lpoNo}</span> },
    { key: 'customerId', header: 'Customer', render: (r) => <span>{customerName.get(r.quotationId) ?? ''}</span> },
    { key: 'quotationId', header: 'Quotation', render: (r) => <span className="font-mono text-xs">{quotationNo.get(r.quotationId) ?? ''}</span> },
    { key: 'receivedOn', header: 'Received', sortable: true },
    { key: 'validUntil', header: 'Valid until', render: (r) => <span>{r.validUntil ?? '—'}</span> },
    { key: 'amount', header: 'Amount', sortable: true, sortAccessor: (r) => Number(r.amount ?? 0), render: (r) => <span className="tabular-nums">{r.amount ? formatCurrency(Number(r.amount), r.currencyCode) : '—'}</span> },
    { key: 'fileId', header: 'File', render: (r) => <span>{r.fileId ? 'Attached' : '—'}</span> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Customer LPO"
        description="Local purchase orders received from customers, linked to a quotation"
        actions={<Button size="sm" onClick={() => { setEditing(null); setFormOpen(true); }}><Plus className="mr-1.5 h-4 w-4" />New LPO</Button>}
      />
      {lpos.isError && <ApiErrorNotice error={lpos.error} onRetry={() => void lpos.refetch()} />}
      {lpos.isLoading && <LoadingState />}
      {lpos.data && (
        <DataTable<CustomerLpoDto>
          columns={columns}
          data={lpos.data}
          searchable
          searchPlaceholder="Search LPOs..."
          searchKeys={['lpoNo']}
          onRowClick={(r) => { setEditing(r); setFormOpen(true); }}
          rowKey={(r) => r.id}
          pageSize={10}
          emptyMessage="No LPOs yet. Click 'New LPO' to add one."
        />
      )}
      <LpoFormDialog open={formOpen} editing={editing} onClose={() => { setFormOpen(false); setEditing(null); }} />
    </div>
  );
}

interface FormState { quotationId: string; hireAgreementId: string; lpoNo: string; receivedOn: string; validUntil: string; amount: string; notes: string }
const EMPTY: FormState = { quotationId: '', hireAgreementId: '', lpoNo: '', receivedOn: new Date().toISOString().slice(0, 10), validUntil: '', amount: '', notes: '' };

function LpoFormDialog({ open, editing, onClose }: { open: boolean; editing: CustomerLpoDto | null; onClose: () => void }) {
  const crm = useCrmData();
  const create = useCreateLpo();
  const update = useUpdateLpo();
  const submission = useSubmission();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [file, setFile] = useState<File | null>(null);
  const [uploadedFileId, setUploadedFileId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [rowVersion, setRowVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null); setFile(null); setUploadedFileId(null);
    if (editing) {
      setForm({
        quotationId: editing.quotationId, hireAgreementId: editing.hireAgreementId ?? '', lpoNo: editing.lpoNo,
        receivedOn: editing.receivedOn, validUntil: editing.validUntil ?? '', amount: editing.amount ?? '', notes: editing.notes ?? '',
      });
      setRowVersion(editing.rowVersion);
    } else {
      setForm({ ...EMPTY, receivedOn: new Date().toISOString().slice(0, 10) });
    }
  }, [open, editing]);

  const set = (k: keyof FormState, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const isEdit = !!editing;
  const quotations = crm.data?.quotations ?? [];
  const agreements = (crm.data?.agreements ?? []).filter((a) => a.quotationId === form.quotationId && a.status !== 'Cancelled');
  const valid = form.quotationId && form.lpoNo.trim() && form.receivedOn;
  const fieldErrors = error ? describeApiError(error).fieldErrors : {};

  /** Uploads once, then waits for the scan to finish. The file can only be attached when it is Clean. */
  const ensureCleanFile = async (): Promise<string | null> => {
    if (!file) return null;
    let id = uploadedFileId;
    if (!id) {
      id = (await uploadLpoFile(file)).id;
      setUploadedFileId(id);
    }
    for (let i = 0; i < SCAN_POLLS; i++) {
      const dto = await filesApi.get(id);
      if (dto.scanStatus === 'Clean') return id;
      if (dto.scanStatus === 'Rejected' || dto.scanStatus === 'Failed') {
        setUploadedFileId(null);
        throw new Error(`The file was ${dto.scanStatus.toLowerCase()} by the scan. Choose a different file.`);
      }
      await sleep(SCAN_WAIT_MS);
    }
    throw new Error('The file is still being scanned. Save again in a moment; the file is kept.');
  };

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      const fileId = await ensureCleanFile();
      const common = {
        lpoNo: form.lpoNo.trim(), receivedOn: form.receivedOn, validUntil: form.validUntil || null,
        amount: form.amount.trim() ? form.amount.trim() : null, notes: form.notes.trim() || null,
        hireAgreementId: form.hireAgreementId || null, ...(fileId ? { fileId } : {}),
      };
      if (editing) {
        await update.mutateAsync({ id: editing.id, rowVersion, patch: common });
        toastSuccess('LPO updated');
      } else {
        const customerId = crm.data?.quotationCustomerIds.get(form.quotationId);
        if (!customerId) throw new Error('Select a quotation.');
        await create.mutateAsync({ body: { ...common, quotationId: form.quotationId, customerId }, submissionId: submission.id() });
        submission.renew();
        toastSuccess('LPO created');
      }
      onClose();
    } catch (err) {
      setError(err); // the form keeps every entered value
    } finally {
      setSaving(false);
    }
  };

  const reload = async () => {
    if (!editing) return;
    setReloading(true);
    try {
      setRowVersion((await fetchLpo(editing.id)).rowVersion); // entered values are not touched
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setReloading(false);
    }
  };

  const selectClass = 'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm';

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{isEdit ? `Edit LPO ${editing?.lpoNo}` : 'New LPO'}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          {error != null && <ApiErrorNotice error={error} onReload={() => void reload()} reloading={reloading} />}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <label htmlFor="lpo-quotation" className="text-xs font-medium text-muted-foreground">Quotation <span className="text-rose-500">*</span></label>
              <select id="lpo-quotation" className={selectClass} value={form.quotationId} disabled={isEdit} onChange={(e) => { set('quotationId', e.target.value); set('hireAgreementId', ''); }}>
                <option value="">Select a quotation</option>
                {quotations.map((q) => <option key={q.id} value={q.id}>{q.number} · {q.customerName} · {q.opportunity}</option>)}
              </select>
              {fieldErrors.quotationId && <p className="text-xs text-rose-500">{fieldErrors.quotationId}</p>}
            </div>
            <div className="space-y-1 sm:col-span-2">
              <label htmlFor="lpo-agreement" className="text-xs font-medium text-muted-foreground">Hire agreement (optional)</label>
              <select id="lpo-agreement" className={selectClass} value={form.hireAgreementId} onChange={(e) => set('hireAgreementId', e.target.value)}>
                <option value="">None</option>
                {agreements.map((a) => <option key={a.id} value={a.id}>{a.agreementNo}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="lpo-no" className="text-xs font-medium text-muted-foreground">LPO number <span className="text-rose-500">*</span></label>
              <Input id="lpo-no" value={form.lpoNo} onChange={(e) => set('lpoNo', e.target.value)} />
              {fieldErrors.lpoNo && <p className="text-xs text-rose-500">{fieldErrors.lpoNo}</p>}
            </div>
            <div className="space-y-1">
              <label htmlFor="lpo-amount" className="text-xs font-medium text-muted-foreground">Amount</label>
              <Input id="lpo-amount" type="number" min={0} value={form.amount} onChange={(e) => set('amount', e.target.value)} />
              {fieldErrors.amount && <p className="text-xs text-rose-500">{fieldErrors.amount}</p>}
            </div>
            <div className="space-y-1">
              <label htmlFor="lpo-received" className="text-xs font-medium text-muted-foreground">Received on <span className="text-rose-500">*</span></label>
              <Input id="lpo-received" type="date" value={form.receivedOn} onChange={(e) => set('receivedOn', e.target.value)} />
            </div>
            <div className="space-y-1">
              <label htmlFor="lpo-valid" className="text-xs font-medium text-muted-foreground">Valid until</label>
              <Input id="lpo-valid" type="date" value={form.validUntil} onChange={(e) => set('validUntil', e.target.value)} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <label htmlFor="lpo-file" className="text-xs font-medium text-muted-foreground">LPO file (optional, PDF, PNG or JPEG)</label>
              <input id="lpo-file" type="file" accept="application/pdf,image/png,image/jpeg" className="text-sm" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setUploadedFileId(null); }} />
              {isEdit && editing?.fileId && !file && <p className="text-xs text-muted-foreground">A file is attached. Choose another file to replace it.</p>}
            </div>
            <div className="space-y-1 sm:col-span-2">
              <label htmlFor="lpo-notes" className="text-xs font-medium text-muted-foreground">Notes</label>
              <Textarea id="lpo-notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!valid || saving} onClick={() => void save()}>{saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create LPO'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
