import { useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiErrorNotice } from '@/components/common/ApiStatus';
import { SectionTitle } from '@/components/common/InfoGrid';
import {
  useAddMachineDocument, useDeactivateMachineDocument, useMachineDocuments, useSubmission,
} from '@/hooks/useApiResources';
import { MACHINE_DOCUMENT_TYPES, type MachineDocumentType } from '../../../shared/dto/index';
import { formatDate } from '@/utils/format';
import { toastSuccess } from '@/lib/toast-helper';

const ACCEPT = 'application/pdf,image/png,image/jpeg';

/** Machine documents from `/api/v1/machines/:id/documents`: list, upload (PDF, PNG or JPEG) and deactivate. */
export function MachineDocumentsSection({ machineId }: { machineId: string }) {
  const docs = useMachineDocuments(machineId);
  const add = useAddMachineDocument(machineId);
  const deactivate = useDeactivateMachineDocument(machineId);
  const submission = useSubmission();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<MachineDocumentType>('Certificate');
  const [expiresOn, setExpiresOn] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<unknown>(null);

  const upload = async () => {
    if (!file) return;
    setError(null);
    try {
      await add.mutateAsync({ file, name: name.trim() || file.name, documentType: type, expiresOn: expiresOn || null, submissionId: submission.id() });
      submission.renew();
      setName(''); setExpiresOn(''); setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      toastSuccess('Document added');
    } catch (err) {
      setError(err); // the chosen file and fields stay in place
    }
  };

  return (
    <div data-testid="machine-documents">
      <SectionTitle>Documents</SectionTitle>
      {docs.isLoading && <p className="py-2 text-sm text-muted-foreground">Loading documents...</p>}
      {docs.isError && <ApiErrorNotice error={docs.error} onRetry={() => void docs.refetch()} />}
      <div className="space-y-2">
        {docs.data?.items.length === 0 && <p className="py-2 text-sm text-muted-foreground">No documents.</p>}
        {docs.data?.items.map((doc) => (
          <div key={doc.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
            <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{doc.name}</p>
              <p className="text-xs text-muted-foreground">{doc.documentType} · Expires {doc.expiresOn ? formatDate(doc.expiresOn) : 'N/A'}</p>
            </div>
            <Button
              variant="ghost" size="sm" disabled={deactivate.isPending}
              onClick={() => deactivate.mutate({ docId: doc.id, rowVersion: doc.rowVersion }, { onError: setError })}
            >
              Deactivate
            </Button>
          </div>
        ))}
      </div>
      {error != null && <ApiErrorNotice className="mt-2" error={error} onReload={() => void docs.refetch()} />}
      <div className="mt-3 grid grid-cols-1 gap-2 rounded-md border border-border p-3 sm:grid-cols-2">
        <Input placeholder="Document name" aria-label="Document name" value={name} onChange={(e) => setName(e.target.value)} />
        <select
          aria-label="Document type" className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          value={type} onChange={(e) => setType(e.target.value as MachineDocumentType)}
        >
          {MACHINE_DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <Input type="date" aria-label="Expires on" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
        <input ref={fileRef} type="file" aria-label="File" accept={ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
        <div className="sm:col-span-2 flex justify-end">
          <Button size="sm" disabled={!file || add.isPending} onClick={() => void upload()}>{add.isPending ? 'Uploading...' : 'Add document'}</Button>
        </div>
      </div>
    </div>
  );
}
