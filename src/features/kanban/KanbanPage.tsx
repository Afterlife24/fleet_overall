import { useState, useMemo, DragEvent } from 'react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/common/StatusBadge';
import { LoadingState } from '@/components/common/EmptyState';
import { useWorkshopJobs, useTransportJobs, useUpdateWorkshopJobStatus, useUpdateTransportJobStatus } from '@/hooks/useQueries';
import { useBranchFilter } from '@/hooks/useBranchFilter';
import { getStatusColor } from '@/utils/statusColors';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Wrench, Truck, GripVertical, MapPin, User } from 'lucide-react';

type BoardMode = 'workshop' | 'transport';

// Ordered pipeline columns for each board
const WORKSHOP_COLUMNS = [
  'Waiting Parts', 'Waiting Mechanic', 'Under Repair', 'Work In Progress', 'Quality Check', 'PDI', 'Available',
] as const;

const TRANSPORT_COLUMNS = [
  'Scheduled', 'Loading', 'In Transit', 'Delivered', 'Returning', 'Completed',
] as const;

export function KanbanPage() {
  const [mode, setMode] = useState<BoardMode>('workshop');

  return (
    <div className="space-y-5">
      <PageHeader
        title="Operations Board"
        description="Drag cards across stages to update their status"
      />

      {/* Board switcher */}
      <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
        <button
          onClick={() => setMode('workshop')}
          className={cn('flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            mode === 'workshop' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
        >
          <Wrench className="h-4 w-4" /> Workshop Pipeline
        </button>
        <button
          onClick={() => setMode('transport')}
          className={cn('flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            mode === 'transport' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
        >
          <Truck className="h-4 w-4" /> Transport Dispatch
        </button>
      </div>

      {mode === 'workshop' ? <WorkshopBoard /> : <TransportBoard />}
    </div>
  );
}

// ── Workshop board ──────────────────────────────────────────────────────────
function WorkshopBoard() {
  const { data: allJobs, isLoading } = useWorkshopJobs();
  const jobs = useBranchFilter(allJobs);
  const updateStatus = useUpdateWorkshopJobStatus();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);

  const byColumn = useMemo(() => {
    const map: Record<string, typeof jobs> = {};
    WORKSHOP_COLUMNS.forEach((c) => (map[c] = []));
    jobs.forEach((j) => { if (map[j.status]) map[j.status].push(j); });
    return map;
  }, [jobs]);

  const onDrop = (col: string) => {
    if (dragId) {
      const job = jobs.find((j) => j.id === dragId);
      if (job && job.status !== col) {
        updateStatus.mutate({ id: dragId, status: col });
        toast.success(`${job.assetNumber} moved to ${col}`);
      }
    }
    setDragId(null);
    setOverCol(null);
  };

  if (isLoading) return <LoadingState />;

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {WORKSHOP_COLUMNS.map((col) => (
        <KanbanColumn
          key={col}
          title={col}
          count={byColumn[col].length}
          isOver={overCol === col}
          onDragOver={(e) => { e.preventDefault(); setOverCol(col); }}
          onDragLeave={() => setOverCol((c) => (c === col ? null : c))}
          onDrop={() => onDrop(col)}
        >
          {byColumn[col].map((job) => (
            <KanbanCard
              key={job.id}
              draggable
              onDragStart={() => setDragId(job.id)}
              onDragEnd={() => { setDragId(null); setOverCol(null); }}
              dragging={dragId === job.id}
            >
              <div className="flex items-start justify-between gap-1">
                <span className="font-semibold text-sm text-foreground">{job.assetNumber}</span>
                <StatusBadge status={job.priority} size="sm" dot={false} />
              </div>
              <p className="text-xs text-muted-foreground truncate">{job.machineModel}</p>
              <p className="mt-1 text-xs text-foreground line-clamp-2">{job.description}</p>
              <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                {job.technicianName && <span className="inline-flex items-center gap-1"><User className="h-3 w-3" />{job.technicianName}</span>}
                {job.bayName && <span>· {job.bayName}</span>}
              </div>
            </KanbanCard>
          ))}
        </KanbanColumn>
      ))}
    </div>
  );
}

// ── Transport board ─────────────────────────────────────────────────────────
function TransportBoard() {
  const { data: allJobs, isLoading } = useTransportJobs();
  const jobs = useBranchFilter(allJobs);
  const updateStatus = useUpdateTransportJobStatus();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);

  const byColumn = useMemo(() => {
    const map: Record<string, typeof jobs> = {};
    TRANSPORT_COLUMNS.forEach((c) => (map[c] = []));
    jobs.forEach((j) => { if (map[j.status]) map[j.status].push(j); });
    return map;
  }, [jobs]);

  const onDrop = (col: string) => {
    if (dragId) {
      const job = jobs.find((j) => j.id === dragId);
      if (job && job.status !== col) {
        updateStatus.mutate({ id: dragId, status: col });
        toast.success(`${job.assetNumber} → ${col}`);
      }
    }
    setDragId(null);
    setOverCol(null);
  };

  if (isLoading) return <LoadingState />;

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {TRANSPORT_COLUMNS.map((col) => (
        <KanbanColumn
          key={col}
          title={col}
          count={byColumn[col].length}
          isOver={overCol === col}
          onDragOver={(e) => { e.preventDefault(); setOverCol(col); }}
          onDragLeave={() => setOverCol((c) => (c === col ? null : c))}
          onDrop={() => onDrop(col)}
        >
          {byColumn[col].map((job) => (
            <KanbanCard
              key={job.id}
              draggable
              onDragStart={() => setDragId(job.id)}
              onDragEnd={() => { setDragId(null); setOverCol(null); }}
              dragging={dragId === job.id}
            >
              <div className="flex items-start justify-between gap-1">
                <span className="font-semibold text-sm text-foreground">{job.assetNumber}</span>
                <StatusBadge status={job.type} size="sm" dot={false} />
              </div>
              <p className="text-xs text-muted-foreground truncate">{job.machineModel}</p>
              <div className="mt-1.5 flex items-center gap-1 text-[11px] text-foreground">
                <MapPin className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="truncate">{job.origin} → {job.destination}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                {job.driverName && <span className="inline-flex items-center gap-1"><User className="h-3 w-3" />{job.driverName}</span>}
                {job.truckRegistration && <span>· {job.truckRegistration}</span>}
              </div>
            </KanbanCard>
          ))}
        </KanbanColumn>
      ))}
    </div>
  );
}

// ── Shared column + card ──────────────────────────────────────────────────────
interface ColumnProps {
  title: string;
  count: number;
  isOver: boolean;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: () => void;
  children: React.ReactNode;
}

function KanbanColumn({ title, count, isOver, onDragOver, onDragLeave, onDrop, children }: ColumnProps) {
  const c = getStatusColor(title);
  return (
    <div
      className={cn(
        'flex w-72 shrink-0 flex-col rounded-lg border bg-muted/30 transition-colors',
        isOver ? 'border-primary ring-2 ring-primary/30' : 'border-border'
      )}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className={cn('h-2.5 w-2.5 rounded-full', c.dot)} />
          <span className="text-sm font-semibold text-foreground">{title}</span>
        </div>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{count}</span>
      </div>
      <div className="flex min-h-[120px] flex-1 flex-col gap-2 p-2">
        {count === 0 && (
          <div className="flex flex-1 items-center justify-center py-6 text-center text-xs text-muted-foreground/60">
            Drop here
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

interface CardProps {
  draggable?: boolean;
  dragging?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  children: React.ReactNode;
}

function KanbanCard({ draggable, dragging, onDragStart, onDragEnd, children }: CardProps) {
  return (
    <Card
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        'group cursor-grab select-none p-2.5 transition-all hover:shadow-md active:cursor-grabbing',
        dragging && 'opacity-40'
      )}
    >
      <div className="flex gap-1.5">
        <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground" />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </Card>
  );
}
