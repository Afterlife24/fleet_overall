import { useState, useMemo } from 'react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/common/StatusBadge';
import { StageTracker } from '@/components/common/StageTracker';
import { Timeline } from '@/components/common/Timeline';
import { LoadingState, EmptyState } from '@/components/common/EmptyState';
import { useWorkshopJobs, useTransportJobs } from '@/hooks/useQueries';
import { useBranchFilter } from '@/hooks/useBranchFilter';
import { cn } from '@/lib/utils';
import { formatDate } from '@/utils/format';
import { Wrench, Truck, MapPin, User, Search, PackageSearch } from 'lucide-react';
import { TimelineEvent } from '@/types/common';

type Mode = 'workshop' | 'transport';

const WORKSHOP_STAGES = [
  'Waiting Parts', 'Waiting Mechanic', 'Under Repair', 'Work In Progress', 'Quality Check', 'PDI', 'Available',
] as const;

const TRANSPORT_STAGES = [
  'Scheduled', 'Loading', 'In Transit', 'Delivered', 'Returning', 'Completed',
] as const;

export function JobTrackingPage() {
  const [mode, setMode] = useState<Mode>('transport');

  return (
    <div className="space-y-5">
      <PageHeader
        title="Job Tracking"
        description="Track the live progress of transport and workshop jobs stage by stage"
      />

      <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
        <button
          onClick={() => setMode('transport')}
          className={cn('flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            mode === 'transport' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
        >
          <Truck className="h-4 w-4" /> Transport Jobs
        </button>
        <button
          onClick={() => setMode('workshop')}
          className={cn('flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            mode === 'workshop' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
        >
          <Wrench className="h-4 w-4" /> Workshop Jobs
        </button>
      </div>

      {mode === 'transport' ? <TransportTracking /> : <WorkshopTracking />}
    </div>
  );
}

// ── Transport tracking ────────────────────────────────────────────────────────
function TransportTracking() {
  const { data: allJobs, isLoading } = useTransportJobs();
  const jobs = useBranchFilter(allJobs);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() =>
    jobs.filter((j) =>
      !search ||
      j.reference.toLowerCase().includes(search.toLowerCase()) ||
      j.assetNumber.toLowerCase().includes(search.toLowerCase()) ||
      j.driverName.toLowerCase().includes(search.toLowerCase())
    ), [jobs, search]);

  const selected = jobs.find((j) => j.id === selectedId) ?? filtered[0];

  if (isLoading) return <LoadingState />;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* Job list */}
      <Card className="p-0 lg:col-span-1">
        <div className="border-b border-border p-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search jobs…"
              className="h-9 w-full rounded-md border border-input bg-transparent pl-8 pr-2 text-sm"
            />
          </div>
        </div>
        <div className="max-h-[520px] divide-y divide-border overflow-y-auto">
          {filtered.map((j) => (
            <button
              key={j.id}
              onClick={() => setSelectedId(j.id)}
              className={cn('flex w-full flex-col items-start gap-1 p-3 text-left transition-colors hover:bg-accent',
                selected?.id === j.id && 'bg-accent')}
            >
              <div className="flex w-full items-center justify-between">
                <span className="text-sm font-semibold text-foreground">{j.assetNumber}</span>
                <StatusBadge status={j.status} size="sm" />
              </div>
              <span className="text-xs text-muted-foreground">{j.reference} · {j.type}</span>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3" />{j.origin} → {j.destination}
              </span>
            </button>
          ))}
          {filtered.length === 0 && <EmptyState icon={PackageSearch} title="No jobs found" />}
        </div>
      </Card>

      {/* Detail */}
      <div className="lg:col-span-2">
        {selected ? (
          <Card className="space-y-5 p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-lg font-semibold text-foreground">{selected.assetNumber}</p>
                <p className="text-sm text-muted-foreground">{selected.machineModel} · {selected.reference}</p>
              </div>
              <StatusBadge status={selected.status} />
            </div>

            <div className="rounded-lg border border-border p-4">
              <StageTracker stages={TRANSPORT_STAGES} current={selected.status} />
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <Detail icon={<User className="h-4 w-4" />} label="Driver" value={selected.driverName} />
              <Detail icon={<Truck className="h-4 w-4" />} label="Truck" value={selected.truckRegistration} />
              <Detail icon={<MapPin className="h-4 w-4" />} label="From" value={selected.origin} />
              <Detail icon={<MapPin className="h-4 w-4" />} label="To" value={selected.destination} />
            </div>
          </Card>
        ) : (
          <Card className="p-8"><EmptyState icon={Truck} title="Select a job to track" /></Card>
        )}
      </div>
    </div>
  );
}

// ── Workshop tracking ─────────────────────────────────────────────────────────
function WorkshopTracking() {
  const { data: allJobs, isLoading } = useWorkshopJobs();
  const jobs = useBranchFilter(allJobs);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() =>
    jobs.filter((j) =>
      !search ||
      j.reference.toLowerCase().includes(search.toLowerCase()) ||
      j.assetNumber.toLowerCase().includes(search.toLowerCase())
    ), [jobs, search]);

  const selected = jobs.find((j) => j.id === selectedId) ?? filtered[0];

  if (isLoading) return <LoadingState />;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="p-0 lg:col-span-1">
        <div className="border-b border-border p-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search jobs…"
              className="h-9 w-full rounded-md border border-input bg-transparent pl-8 pr-2 text-sm"
            />
          </div>
        </div>
        <div className="max-h-[520px] divide-y divide-border overflow-y-auto">
          {filtered.map((j) => (
            <button
              key={j.id}
              onClick={() => setSelectedId(j.id)}
              className={cn('flex w-full flex-col items-start gap-1 p-3 text-left transition-colors hover:bg-accent',
                selected?.id === j.id && 'bg-accent')}
            >
              <div className="flex w-full items-center justify-between">
                <span className="text-sm font-semibold text-foreground">{j.assetNumber}</span>
                <StatusBadge status={j.status} size="sm" />
              </div>
              <span className="text-xs text-muted-foreground">{j.reference}</span>
              <span className="text-xs text-muted-foreground line-clamp-1">{j.description}</span>
            </button>
          ))}
          {filtered.length === 0 && <EmptyState icon={PackageSearch} title="No jobs found" />}
        </div>
      </Card>

      <div className="lg:col-span-2">
        {selected ? (
          <Card className="space-y-5 p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-lg font-semibold text-foreground">{selected.assetNumber}</p>
                <p className="text-sm text-muted-foreground">{selected.machineModel} · {selected.reference}</p>
              </div>
              <StatusBadge status={selected.status} />
            </div>

            <div className="rounded-lg border border-border p-4 overflow-x-auto">
              <StageTracker stages={WORKSHOP_STAGES} current={selected.status} className="min-w-[640px]" />
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <Detail icon={<User className="h-4 w-4" />} label="Technician" value={selected.technicianName ?? 'Unassigned'} />
              <Detail icon={<Wrench className="h-4 w-4" />} label="Bay" value={selected.bayName ?? '—'} />
              <Detail icon={<PackageSearch className="h-4 w-4" />} label="Priority" value={selected.priority} />
              <Detail icon={<Wrench className="h-4 w-4" />} label="Est. Hours" value={`${selected.estimatedHours}h`} />
            </div>

            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Description</p>
              <p className="text-sm text-foreground">{selected.description}</p>
            </div>

            {selected.timeline && selected.timeline.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-semibold text-foreground">Activity</p>
                <Timeline events={selected.timeline as TimelineEvent[]} compact />
              </div>
            )}
          </Card>
        ) : (
          <Card className="p-8"><EmptyState icon={Wrench} title="Select a job to track" /></Card>
        )}
      </div>
    </div>
  );
}

function Detail({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-border p-3">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-medium text-foreground">{value}</p>
      </div>
    </div>
  );
}
