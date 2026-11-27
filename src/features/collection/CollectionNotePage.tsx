import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { SlideOver } from '@/components/common/SlideOver';
import { LoadingState } from '@/components/common/EmptyState';
import { ApiErrorNotice, ApiSessionGate } from '@/components/common/ApiStatus';
import { DataTable, type Column } from '@/components/tables/DataTable';
import { Button } from '@/components/ui/button';
import { CollectionDetail } from '@/features/collection/CollectionDetail';
import { InitiateDialog } from '@/features/collection/InitiateDialog';
import { useCollectionNotes } from '@/hooks/api/useCollectionApi';
import type { InitiateResult } from '@/services/collectionDocs';
import type { CollectionNote } from '@/types/collection';

export function CollectionNotePage() {
  return (
    <ApiSessionGate>
      <CollectionNotes />
    </ApiSessionGate>
  );
}

function CollectionNotes() {
  const notesQuery = useCollectionNotes();
  const notes = notesQuery.data ?? [];
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const stateMachineId = (location.state as { machineId?: string } | null)?.machineId;
  const stateBookingId = (location.state as { bookingId?: string } | null)?.bookingId;
  const [selectedId, setSelectedId] = useState<string | null>(params.get('id'));
  const [dialogOpen, setDialogOpen] = useState(!!stateMachineId || !!stateBookingId);
  const [preselectMachine, setPreselectMachine] = useState<string | undefined>(stateMachineId);
  const [preselectBooking, setPreselectBooking] = useState<string | undefined>(stateBookingId);

  useEffect(() => {
    const id = params.get('id');
    if (id) setSelectedId(id);
  }, [params]);

  useEffect(() => {
    if (stateMachineId || stateBookingId) {
      setPreselectMachine(stateMachineId);
      setPreselectBooking(stateBookingId);
      setDialogOpen(true);
      // Clear the navigation state so a refresh does not reopen the dialog.
      navigate(location.pathname + location.search, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateMachineId, stateBookingId]);

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
    { key: 'bookingRef', header: 'Booking', sortable: true, sortAccessor: (n) => n.bookingRef, render: (n) => n.bookingRef || '—' },
    { key: 'invoiceNo', header: 'Invoice', sortable: true, sortAccessor: (n) => n.invoiceNo, render: (n) => n.invoiceNo || '—' },
    { key: 'date', header: 'Date', sortable: true, sortAccessor: (n) => n.date, render: (n) => n.date },
    { key: 'status', header: 'Status', sortable: true, sortAccessor: (n) => n.status, render: (n) => n.status },
  ];

  if (notesQuery.isLoading) return <LoadingState />;
  if (notesQuery.isError) return <ApiErrorNotice error={notesQuery.error} onRetry={() => void notesQuery.refetch()} />;

  const selected = selectedId ? notes.find((n) => n.id === selectedId) : undefined;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Collection Notes"
        description="Off-hire and collection documents"
        actions={
          <Button
            onClick={() => {
              setPreselectMachine(undefined);
              setPreselectBooking(undefined);
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
        searchKeys={['number', 'fleetNo', 'customerName', 'bookingRef', 'invoiceNo']}
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
        preselectMachineId={preselectMachine}
        preselectBookingId={preselectBooking}
        onCreated={handleCreated}
      />
    </div>
  );
}

export default CollectionNotePage;
