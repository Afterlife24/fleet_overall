import { useState } from 'react';
import { PageHeader } from '@/components/common/PageHeader';
import { ApiErrorNotice, ApiSessionGate } from '@/components/common/ApiStatus';
import { LoadingState } from '@/components/common/EmptyState';
import { DataTable, type Column } from '@/components/tables/DataTable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Calendar, List } from 'lucide-react';
import { useBookings } from '@/hooks/api/usePlannerApi';
import type { Booking } from '@/types/booking';
import { CalendarView } from './CalendarView';
import { BookingFormDialog } from './BookingFormDialog';
import { BookingDetailDialog } from './BookingDetailDialog';
import { displayStatus } from './bookingRecord';

/** Planner (Hire Desk). Reads and writes bookings through `/api/v1/bookings`; waits for the API session. */
export function PlannerPage() {
  return (
    <ApiSessionGate>
      <PlannerScreen />
    </ApiSessionGate>
  );
}

function PlannerScreen() {
  const bookings = useBookings();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Booking | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('calendar');
  const today = new Date().toISOString().slice(0, 10);

  const openNew = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (b: Booking) => { setDetailId(null); setEditing(b); setFormOpen(true); };

  const columns: Column<Booking>[] = [
    { key: 'reference', header: 'Reference', sortable: true, render: (r) => <span className="font-mono text-xs font-semibold">{r.reference}</span> },
    { key: 'customerName', header: 'Customer', sortable: true },
    { key: 'assetNumber', header: 'Machine', sortable: true, render: (r) => <span>{r.assetNumber} {r.machineModel}</span> },
    { key: 'startDate', header: 'Start', sortable: true },
    { key: 'endDate', header: 'End', sortable: true },
    { key: 'agreementNo', header: 'Agreement', render: (r) => <span className="font-mono text-xs">{r.agreementNo ?? '—'}</span> },
    { key: 'status', header: 'Status', sortable: true, render: (r) => <Badge variant="outline">{displayStatus(r, today)}</Badge> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Planner (Hire Desk)"
        description="14-day booking calendar with exact Excel layout and colors"
        actions={
          <Button size="sm" onClick={openNew}>
            <Plus className="mr-1.5 h-4 w-4" /> New Booking
          </Button>
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="calendar">
            <Calendar className="mr-2 h-4 w-4" />
            Calendar View
          </TabsTrigger>
          <TabsTrigger value="list">
            <List className="mr-2 h-4 w-4" />
            List View
          </TabsTrigger>
        </TabsList>

        <TabsContent value="calendar" className="mt-4">
          <CalendarView onSelectBooking={(b) => setDetailId(b.id)} />
        </TabsContent>

        <TabsContent value="list" className="mt-4 space-y-3">
          {bookings.isError && <ApiErrorNotice error={bookings.error} onRetry={() => void bookings.refetch()} />}
          {bookings.isLoading && <LoadingState />}
          {bookings.data && (
            <DataTable<Booking>
              columns={columns}
              data={bookings.data}
              searchable
              searchPlaceholder="Search bookings..."
              searchKeys={['reference', 'customerName', 'assetNumber', 'status']}
              onRowClick={(r) => setDetailId(r.id)}
              rowKey={(r) => r.id}
              pageSize={15}
              emptyMessage="No bookings yet. Click 'New Booking' to add one."
            />
          )}
        </TabsContent>
      </Tabs>

      <BookingFormDialog
        open={formOpen}
        booking={editing}
        onClose={() => { setFormOpen(false); setEditing(null); }}
      />
      <BookingDetailDialog bookingId={detailId} onClose={() => setDetailId(null)} onEdit={openEdit} />
    </div>
  );
}
