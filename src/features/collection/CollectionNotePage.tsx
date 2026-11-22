import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { SlideOver } from '@/components/common/SlideOver';
import { DataTable, type Column } from '@/components/tables/DataTable';
import { Button } from '@/components/ui/button';
import { CollectionDetail } from '@/features/collection/CollectionDetail';
import { InitiateDialog } from '@/features/collection/InitiateDialog';
import {
  useCollections,
  type InitiateResult,
  type MachineResolver,
  type TransportJobCallback,
} from '@/services/collectionDocs';
import type { CollectionNote } from '@/types/collection';

interface CollectionNotePageProps {
  machines?: MachineResolver;
  createTransportJob?: TransportJobCallback;
}

const NO_MACHINES: MachineResolver = { list: () => [], statusOf: () => '' };

export function CollectionNotePage({ machines = NO_MACHINES, createTransportJob }: CollectionNotePageProps) {
  const notes = useCollections();
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const stateMachineId = (location.state as { machineId?: string } | null)?.machineId;
  const [selectedId, setSelectedId] = useState<string | null>(params.get('id'));
  const [dialogOpen, setDialogOpen] = useState(!!stateMachineId);
  const [preselect, setPreselect] = useState<string | undefined>(stateMachineId);

  useEffect(() => {
    const id = params.get('id');
    if (id) setSelectedId(id);
  }, [params]);

  useEffect(() => {
    if (stateMachineId) {
      setPreselect(stateMachineId);
      setDialogOpen(true);
      // Clear the navigation state so a refresh does not reopen the dialog.
      navigate(location.pathname + location.search, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateMachineId]);

  const close = () => {
    setSelectedId(null);
    if (params.has('id')) {
      const next = new URLSearchParams(params);
      next.delete('id');
      setParams(next, { replace: true });
    }
  };

  const handleCreated = (result: InitiateResult) => {
    if (result.ok && result.cn) {
      setDialogOpen(false);
      setSelectedId(result.cn.id);
    }
  };

  const columns: Column<CollectionNote>[] = [
    { key: 'number', header: 'Number', sortable: true, sortAccessor: (n) => n.number, render: (n) => <span className="font-medium">{n.number}</span> },
    { key: 'fleetNo', header: 'Fleet No', sortable: true, sortAccessor: (n) => n.fleetNo, render: (n) => n.fleetNo || '—' },
    { key: 'customerName', header: 'Customer', sortable: true, sortAccessor: (n) => n.customerName, render: (n) => n.customerName || '—' },
    { key: 'quotationNo', header: 'Quotation', sortable: true, sortAccessor: (n) => n.quotationNo, render: (n) => n.quotationNo || '—' },
    { key: 'invoiceNo', header: 'Invoice', sortable: true, sortAccessor: (n) => n.invoiceNo, render: (n) => n.invoiceNo || '—' },
    { key: 'date', header: 'Date', sortable: true, sortAccessor: (n) => n.date, render: (n) => n.date },
    { key: 'status', header: 'Status', sortable: true, sortAccessor: (n) => n.status, render: (n) => n.status },
    { key: 'signedStatus', header: 'Signed', sortable: true, sortAccessor: (n) => n.signedStatus, render: (n) => n.signedStatus },
  ];

  const selected = selectedId ? notes.find((n) => n.id === selectedId) : undefined;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Collection Notes"
        description="Off-hire and collection documents"
        actions={
          <Button
            onClick={() => {
              setPreselect(undefined);
              setDialogOpen(true);
            }}
          >
            <Plus className="mr-1 h-4 w-4" /> Initiate Off-Hire / Collection
          </Button>
        }
      />
      <DataTable
        columns={columns}
        data={notes}
        searchable
        searchKeys={['number', 'fleetNo', 'customerName', 'quotationNo', 'invoiceNo']}
        initialSort={{ key: 'number', direction: 'desc' }}
        rowKey={(n) => n.id}
        onRowClick={(n) => setSelectedId(n.id)}
        emptyMessage="No collection notes yet."
      />
      <SlideOver
        open={!!selectedId}
        onClose={close}
        title={selected?.number ?? 'Collection Note'}
        width="xl"
      >
        {selectedId && <CollectionDetail noteId={selectedId} onClose={close} />}
      </SlideOver>
      <InitiateDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        machines={machines}
        createTransportJob={createTransportJob}
        preselectMachineId={preselect}
        onCreated={handleCreated}
      />
    </div>
  );
}

export default CollectionNotePage;
