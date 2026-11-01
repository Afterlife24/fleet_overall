import { useState } from 'react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Avatar } from '@/components/common/Avatar';
import { SlideOver } from '@/components/common/SlideOver';
import { InfoGrid, InfoRow, SectionTitle } from '@/components/common/InfoGrid';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTransportJobs, useDrivers, useTrucks } from '@/hooks/useQueries';
import { useBranchFilter } from '@/hooks/useBranchFilter';
import { TransportJob, TransportJobStatus } from '@/types/transport';
import { formatDateTime } from '@/utils/format';
import { cn } from '@/lib/utils';
import { toastSuccess } from '@/lib/toast-helper';
import { useAppStore } from '@/store/appStore';
import { TransportJobDialog } from './TransportJobDialog';
import { Truck, MapPin, Plus, Navigation, ArrowRightLeft } from 'lucide-react';

export function TransportPage() {
  const { data: jobs } = useTransportJobs();
  const { data: drivers } = useDrivers();
  const { data: trucks } = useTrucks();
  const filteredJobs = useBranchFilter(jobs);
  const filteredDrivers = useBranchFilter(drivers);
  const filteredTrucks = useBranchFilter(trucks);
  const [selected, setSelected] = useState<TransportJob | null>(null);
  const [createJobOpen, setCreateJobOpen] = useState(false);
  const [reassigningDriver, setReassigningDriver] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const { updateTransportJob } = useAppStore();

  const activeJobs = filteredJobs.filter((j) => j.status === 'In Transit' || j.status === 'Loading').length;
  const scheduledJobs = filteredJobs.filter((j) => j.status === 'Scheduled').length;
  const completedJobs = filteredJobs.filter((j) => j.status === 'Completed' || j.status === 'Delivered').length;
  const availableDrivers = filteredDrivers.filter((d) => d.status === 'Available').length;

  const todayDeliveries = filteredJobs.filter((j) => j.type === 'Delivery').length;
  const todayCollections = filteredJobs.filter((j) => j.type === 'Collection').length;

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
            {filteredJobs.slice(0, 8).map((job) => {
              const driver = drivers?.find((d) => d.id === job.driverId);
              return (
                <button
                  key={job.id}
                  onClick={() => setSelected(job)}
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
                      <span className="flex items-center gap-0.5"><MapPin className="h-3 w-3" />{job.destination.split('-')[0]}</span>
                      <span className="flex items-center gap-0.5"><Navigation className="h-3 w-3" />{job.distance}km</span>
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
                <p className="text-xs text-muted-foreground">{truck.type} · {truck.capacity}T</p>
              </div>
              <StatusBadge status={truck.status} size="sm" />
            </div>
          ))}
        </div>
      </Card>

      {/* Job detail */}
      <SlideOver
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? selected.reference : ''}
        description={selected ? `${selected.assetNumber} · ${selected.machineModel}` : ''}
        width="md"
        footer={
          selected && (
            <div className="space-y-2">
              {/* Reassign Driver */}
              <div className="flex items-center gap-2">
                <Select
                  disabled={reassigningDriver}
                  onValueChange={(driverId) => {
                    if (!selected) return;
                    setReassigningDriver(true);
                    const driver = filteredDrivers?.find(d => d.id === driverId);
                    updateTransportJob(selected.id, {
                      driverId,
                      driverName: driver?.name ?? driverId,
                    });
                    toastSuccess(`Driver ${driver?.name} assigned`);
                    setReassigningDriver(false);
                    setSelected({ ...selected, driverId, driverName: driver?.name ?? driverId });
                  }}
                >
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Reassign Driver..." /></SelectTrigger>
                  <SelectContent>
                    {filteredDrivers?.map(d => (
                      <SelectItem key={d.id} value={d.id}>{d.name} · {d.branchName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {/* Update Status */}
              <div className="flex items-center gap-2">
                <Select
                  disabled={updatingStatus}
                  onValueChange={(newStatus) => {
                    if (!selected) return;
                    setUpdatingStatus(true);
                    updateTransportJob(selected.id, { status: newStatus as TransportJobStatus });
                    toastSuccess(`Status updated to ${newStatus}`);
                    setUpdatingStatus(false);
                    setSelected({ ...selected, status: newStatus as TransportJobStatus });
                  }}
                >
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Update Status..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Scheduled">Scheduled</SelectItem>
                    <SelectItem value="In Transit">In Transit</SelectItem>
                    <SelectItem value="Completed">Completed</SelectItem>
                    <SelectItem value="Cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )
        }
      >
        {selected && (
          <div className="space-y-1">
            <div className="mb-4 flex items-center gap-2">
              <StatusBadge status={selected.status} />
              <StatusBadge status={selected.type} size="sm" />
              {(selected as any).shift && <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">{(selected as any).shift}</span>}
            </div>
            <SectionTitle>Transport Schedule (REF-13)</SectionTitle>
            <InfoGrid columns={2}>
              <InfoRow label="Sr. No" value={(selected as any).srNo ?? '—'} />
              <InfoRow label="Planner" value={(selected as any).plannerName ?? '—'} />
              <InfoRow label="Date" value={(selected as any).date ?? ''} />
              <InfoRow label="Shift" value={(selected as any).shift ?? '—'} />
              <InfoRow label="Transport Team" value={(selected as any).transportTeam ?? selected.truckRegistration} />
              <InfoRow label="Fleet (EqptNo)" value={(selected as any).fleet ?? selected.assetNumber} />
            </InfoGrid>
            <SectionTitle>Route Details</SectionTitle>
            <InfoGrid columns={2}>
              <InfoRow label="From" value={(selected as any).from ?? selected.origin} />
              <InfoRow label="To" value={(selected as any).to ?? selected.destination} />
              <InfoRow label="Transport Vehicle" value={(selected as any).transport ?? selected.truckRegistration} />
              <InfoRow label="Type" value={(selected as any).type ?? selected.type} />
              <InfoRow label="Contact" value={(selected as any).contact ?? '—'} />
              <InfoRow label="Sales Rep" value={(selected as any).sales ?? '—'} />
              <InfoRow label="Client" value={(selected as any).client ?? '—'} />
              <InfoRow label="Time" value={(selected as any).time ?? formatDateTime(selected.scheduledTime)} />
            </InfoGrid>
            {(selected as any).remarks && (
              <>
                <SectionTitle>Remarks</SectionTitle>
                <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">{(selected as any).remarks}</p>
              </>
            )}
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
