import { useState } from 'react';
import { ApiErrorNotice, ApiSessionGate, errorText } from '@/components/common/ApiStatus';
import { LoadingState } from '@/components/common/EmptyState';
import { PageHeader } from '@/components/common/PageHeader';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Avatar } from '@/components/common/Avatar';
import { SlideOver } from '@/components/common/SlideOver';
import { InfoGrid, InfoRow, SectionTitle } from '@/components/common/InfoGrid';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  useChangeTransportJobStatus, useDriverViews, useTransportJobViews, useTruckViews, useUpdateTransportJobApi,
} from '@/hooks/api/useTransportApi';
import type { TransportJobStatusValue } from '@/services/api/transport';
import { ref13Rows, transportCounters } from '@/services/transportCore';
import { cn } from '@/lib/utils';
import { toastSuccess, toastError } from '@/lib/toast-helper';
import { TransportJobDialog } from './TransportJobDialog';
import { Truck, MapPin, Plus, Navigation, ArrowRightLeft } from 'lucide-react';

/** The next statuses a job may move to (the server enforces the same order). */
const NEXT_STATUS: Record<TransportJobStatusValue, TransportJobStatusValue[]> = {
  Scheduled: ['Loading', 'Cancelled'],
  Loading: ['In Transit', 'Cancelled'],
  'In Transit': ['Delivered', 'Cancelled'],
  Delivered: ['Returning', 'Cancelled'],
  Returning: ['Completed', 'Cancelled'],
  Completed: [],
  Cancelled: [],
};

export function TransportPage() {
  return (
    <ApiSessionGate>
      <TransportBoard />
    </ApiSessionGate>
  );
}

function TransportBoard() {
  const jobsQuery = useTransportJobViews();
  const driversQuery = useDriverViews();
  const trucksQuery = useTruckViews();
  // The server already limits every list to the branches this user may see.
  const filteredJobs = jobsQuery.data ?? [];
  const filteredDrivers = driversQuery.data ?? [];
  const filteredTrucks = trucksQuery.data ?? [];
  const drivers = driversQuery.data;
  // Keep the id, not the row, so the panel always shows the stored status and driver.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = filteredJobs.find((j) => j.id === selectedId) ?? null;
  const [createJobOpen, setCreateJobOpen] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const updateJob = useUpdateTransportJobApi();
  const changeStatus = useChangeTransportJobStatus();
  const busy = updateJob.isPending || changeStatus.isPending;

  const counters = transportCounters(filteredJobs);
  const activeJobs = counters.active;
  const scheduledJobs = counters.scheduled;
  const completedJobs = counters.completed;
  const availableDrivers = filteredDrivers.filter((d) => d.status === 'Available').length;

  const todayDeliveries = counters.deliveries;
  const todayCollections = counters.collections;

  const reload = () => { setActionError(null); jobsQuery.refetch(); };
  const assignDriver = (driverId: string) => {
    if (!selected) return;
    const driver = filteredDrivers.find((d) => d.id === driverId);
    setActionError(null);
    updateJob.mutate(
      { id: selected.id, rowVersion: selected.rowVersion, patch: { driverId } },
      {
        onSuccess: () => toastSuccess(`Driver ${driver?.name ?? driverId} assigned`),
        onError: (err) => { setActionError(err); toastError(errorText(err)); },
      },
    );
  };
  const setStatus = (status: TransportJobStatusValue) => {
    if (!selected) return;
    setActionError(null);
    changeStatus.mutate(
      { id: selected.id, rowVersion: selected.rowVersion, status },
      {
        onSuccess: () => toastSuccess(`Status updated to ${status}`),
        onError: (err) => { setActionError(err); toastError(errorText(err)); },
      },
    );
  };

  if (jobsQuery.isLoading) return <LoadingState />;
  if (jobsQuery.isError) return <ApiErrorNotice error={jobsQuery.error} onRetry={jobsQuery.refetch} />;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Transport Dispatch"
        description="Driver assignments, trucks, and delivery routes"
        actions={<Button size="sm" onClick={() => setCreateJobOpen(true)}><Plus className="mr-1.5 h-4 w-4" /> New Transport Job</Button>}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Active Jobs</p>
          <p className="mt-1 text-xl font-semibold text-sky-600 dark:text-sky-400">{activeJobs}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Scheduled</p>
          <p className="mt-1 text-xl font-semibold text-amber-600 dark:text-amber-400">{scheduledJobs}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Completed</p>
          <p className="mt-1 text-xl font-semibold text-emerald-600 dark:text-emerald-400">{completedJobs}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Available Drivers</p>
          <p className="mt-1 text-xl font-semibold">{availableDrivers}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-1.5"><Navigation className="h-3.5 w-3.5 text-sky-500" /><p className="text-xs text-muted-foreground uppercase tracking-wider">Deliveries</p></div>
          <p className="mt-1 text-xl font-semibold">{todayDeliveries}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-1.5"><ArrowRightLeft className="h-3.5 w-3.5 text-emerald-500" /><p className="text-xs text-muted-foreground uppercase tracking-wider">Collections</p></div>
          <p className="mt-1 text-xl font-semibold">{todayCollections}</p>
        </Card>
      </div>

      {/* Dispatch Board */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Today's Dispatch Board</h3>
          <div className="space-y-2">
            {filteredJobs.map((job) => {
              const driver = drivers?.find((d) => d.id === job.driverId);
              return (
                <button
                  key={job.id}
                  onClick={() => { setActionError(null); setSelectedId(job.id); }}
                  className="flex w-full items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/30"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <Truck className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-foreground">{job.reference}</p>
                      <StatusBadge status={job.status} size="sm" />
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{job.assetNumber} · {job.machineModel}</p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-0.5"><MapPin className="h-3 w-3" />{job.destination?.split('-')[0] ?? '—'}</span>
                      <span className="flex items-center gap-0.5"><Navigation className="h-3 w-3" />{job.distance ?? '—'}{job.distance !== undefined ? 'km' : ''}</span>
                    </div>
                  </div>
                  {driver && <Avatar name={driver.name} color="#0ea5e9" size="sm" />}
                </button>
              );
            })}
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Driver Assignments</h3>
          <div className="space-y-2">
            {filteredDrivers.slice(0, 8).map((driver) => {
              const driverJobs = filteredJobs.filter((j) => j.driverId === driver.id && j.status !== 'Completed');
              return (
                <div key={driver.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                  <Avatar name={driver.name} color="#0ea5e9" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{driver.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{driver.branchName}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <StatusBadge status={driver.status} size="sm" />
                    <span className="text-xs text-muted-foreground">{driverJobs.length} active job{driverJobs.length !== 1 ? 's' : ''}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Trucks */}
      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">Truck Fleet</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {filteredTrucks.slice(0, 12).map((truck) => (
            <div key={truck.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                <Truck className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{truck.registration}</p>
                <p className="text-xs text-muted-foreground">{truck.type} · {Number(truck.capacityKg).toLocaleString()} kg</p>
              </div>
              <StatusBadge status={truck.status} size="sm" />
            </div>
          ))}
        </div>
      </Card>

      {/* Job detail */}
      <SlideOver
        open={!!selected}
        onClose={() => { setActionError(null); setSelectedId(null); }}
        title={selected ? selected.reference : ''}
        description={selected ? `${selected.assetNumber} · ${selected.machineModel}` : ''}
        width="md"
        footer={
          selected && (
            <div className="space-y-2">
              {actionError != null && <ApiErrorNotice error={actionError} onReload={reload} />}
              <div className="flex items-center gap-2">
                <Select disabled={busy} value="" onValueChange={assignDriver}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder={selected.driverName ? `Driver: ${selected.driverName} (reassign...)` : 'Assign Driver...'} /></SelectTrigger>
                  <SelectContent>
                    {filteredDrivers.map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.name} · {d.branchName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Select disabled={busy || NEXT_STATUS[selected.status].length === 0} value="" onValueChange={(v) => setStatus(v as TransportJobStatusValue)}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder={NEXT_STATUS[selected.status].length === 0 ? `Status: ${selected.status}` : 'Update Status...'} /></SelectTrigger>
                  <SelectContent>
                    {NEXT_STATUS[selected.status].map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>          )
        }
      >
        {selected && (
          <div className="space-y-1">
            <div className="mb-4 flex items-center gap-2">
              <StatusBadge status={selected.status} />
              <StatusBadge status={selected.type} size="sm" />
            </div>
            <SectionTitle>Transport Schedule (REF-13)</SectionTitle>
            <InfoGrid columns={2}>
              {ref13Rows(selected).map((row) => (
                <InfoRow key={row.label} label={row.label} value={row.value} />
              ))}
            </InfoGrid>
          </div>
        )}
      </SlideOver>

      <TransportJobDialog 
        open={createJobOpen} 
        onClose={() => setCreateJobOpen(false)} 
      />
    </div>
  );
}
