import { useState, useMemo } from 'react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Avatar } from '@/components/common/Avatar';
import { SlideOver } from '@/components/common/SlideOver';
import { InfoGrid, InfoRow, SectionTitle } from '@/components/common/InfoGrid';
import { Timeline } from '@/components/common/Timeline';
import { Button } from '@/components/ui/button';
import { useWorkshopJobs, useTechnicians, useBays } from '@/hooks/useQueries';
import { useBranchFilter } from '@/hooks/useBranchFilter';
import { WorkshopJob, WorkshopStatus } from '@/types/workshop';
import { formatDate, formatNumber } from '@/utils/format';
import { cn } from '@/lib/utils';
import { UpdateJobStatusDialog } from './UpdateJobStatusDialog';
import { AssignTechnicianDialog } from './AssignTechnicianDialog';
import { CreateJobDialog } from './CreateJobDialog';
import { JobCardDialog } from './JobCardDialog';
import { Wrench, Clock, Package, Plus, AlertCircle, Calendar, User, FileText } from 'lucide-react';

const COLUMNS: { status: WorkshopStatus; color: string; label: string }[] = [
  { status: 'Waiting Parts' as WorkshopStatus, color: 'border-t-amber-500', label: 'Waiting Parts' },
  { status: 'Waiting Mechanic' as WorkshopStatus, color: 'border-t-orange-500', label: 'Waiting Technician' },
  { status: 'Under Repair' as WorkshopStatus, color: 'border-t-rose-500', label: 'Under Repair' },
  { status: 'Work In Progress' as WorkshopStatus, color: 'border-t-sky-500', label: 'Work In Progress' },
  { status: 'PDI' as WorkshopStatus, color: 'border-t-teal-500', label: 'PDI' },
  { status: 'Quality Check' as WorkshopStatus, color: 'border-t-violet-500', label: 'Quality Check' },
];

function daysWaiting(scheduledDate: string): number {
  const now = new Date().getTime();
  const scheduled = new Date(scheduledDate).getTime();
  return Math.max(0, Math.floor((now - scheduled) / 86400000));
}

export function WorkshopPage() {
  const { data: jobs } = useWorkshopJobs();
  const { data: techs } = useTechnicians();
  const { data: bays } = useBays();
  const filteredJobs = useBranchFilter(jobs);
  const filteredBays = useBranchFilter(bays);
  const filteredTechs = useBranchFilter(techs);
  const [selected, setSelected] = useState<WorkshopJob | null>(null);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [createJobOpen, setCreateJobOpen] = useState(false);
  const [jobCardOpen, setJobCardOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<WorkshopJob | null>(null);

  const jobsByStatus = useMemo(() => {
    const map: Record<string, WorkshopJob[]> = {};
    for (const col of COLUMNS) {
      map[col.status] = filteredJobs.filter((j) => j.status === col.status);
    }
    return map;
  }, [filteredJobs]);

  const occupiedBays = filteredBays?.filter((b) => b.status === 'Occupied').length ?? 0;
  const availableBays = filteredBays?.filter((b) => b.status === 'Available').length ?? 0;
  const criticalCount = filteredJobs.filter((j) => j.priority === 'Critical').length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Workshop Board"
        description="Track machines through repair stages across all bays"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setJobCardOpen(true)}><FileText className="mr-1.5 h-4 w-4" /> Job Card</Button>
            <Button size="sm" onClick={() => setCreateJobOpen(true)}><Plus className="mr-1.5 h-4 w-4" /> New Job</Button>
          </>
        }
      />

      {/* Bay stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Jobs</p>
          <p className="mt-1 text-xl font-semibold">{filteredJobs.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Occupied Bays</p>
          <p className="mt-1 text-xl font-semibold text-amber-600 dark:text-amber-400">{occupiedBays}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Available Bays</p>
          <p className="mt-1 text-xl font-semibold text-emerald-600 dark:text-emerald-400">{availableBays}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Critical Priority</p>
          <p className="mt-1 text-xl font-semibold text-rose-600 dark:text-rose-400">{criticalCount}</p>
        </Card>
      </div>

      {/* Kanban Board */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {COLUMNS.map((col) => {
          const colJobs = jobsByStatus[col.status] ?? [];
          return (
            <div key={col.status} className="flex w-72 shrink-0 flex-col">
              <div className={cn('rounded-t-lg border-t-2 border-x border-border bg-muted/30 px-3 py-2.5', col.color)}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">{col.label}</span>
                  <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-background px-1.5 text-xs font-medium text-muted-foreground">
                    {colJobs.length}
                  </span>
                </div>
              </div>
              <div className="flex flex-1 flex-col gap-2 overflow-y-auto border-x border-b border-border bg-muted/10 p-2" style={{ maxHeight: 'calc(100vh - 320px)' }}>
                {colJobs.map((job) => {
                  const tech = techs?.find((t) => t.id === job.technicianId);
                  const waitingDays = daysWaiting(job.scheduledDate);
                  const estFinishDate = new Date(new Date(job.scheduledDate).getTime() + job.estimatedHours * 3600000);
                  return (
                    <button
                      key={job.id}
                      onClick={() => setSelected(job)}
                      className="group rounded-lg border border-border bg-card p-3 text-left shadow-sm transition-all hover:shadow-md hover:border-primary/40"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-muted-foreground">{job.reference}</p>
                          <p className="mt-0.5 truncate text-sm font-semibold text-foreground">{job.assetNumber}</p>
                          <p className="truncate text-xs text-muted-foreground">{job.machineModel}</p>
                        </div>
                        {job.priority === 'Critical' && (
                          <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-400">
                            {job.priority}
                          </span>
                        )}
                      </div>
                      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{job.description}</p>
                      <div className="mt-2.5 space-y-1.5 border-t border-border pt-2.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            {tech ? (
                              <>
                                <Avatar name={tech.name} color={tech.avatarColor} size="sm" />
                                <span className="text-xs text-muted-foreground">{tech.name.split(' ')[0]}</span>
                              </>
                            ) : (
                              <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                                <AlertCircle className="h-3.5 w-3.5" /> Unassigned
                              </span>
                            )}
                          </div>
                          <span className={cn('text-xs', waitingDays > 3 ? 'text-rose-600 dark:text-rose-400 font-medium' : 'text-muted-foreground')}>
                            {waitingDays}d waiting
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span className="flex items-center gap-0.5"><Clock className="h-3 w-3" />{job.estimatedHours}h est.</span>
                          <span className="flex items-center gap-0.5"><Calendar className="h-3 w-3" />{formatDate(estFinishDate.toISOString())}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
                {colJobs.length === 0 && (
                  <div className="flex flex-1 items-center justify-center py-8 text-xs text-muted-foreground">
                    No jobs
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Detail Drawer */}
      <SlideOver
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `Job ${selected.reference}` : ''}
        description={selected ? `${selected.assetNumber} · ${selected.machineModel}` : ''}
        width="lg"
        footer={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={() => { setSelectedJob(selected); setAssignDialogOpen(true); }}>Reassign</Button>
            <Button size="sm" className="flex-1" onClick={() => { setSelectedJob(selected); setStatusDialogOpen(true); }}>Update Status</Button>
          </div>
        }
      >
        {selected && (
          <div className="space-y-1">
            <div className="mb-4 flex items-center gap-2">
              <StatusBadge status={selected.status} />
              <StatusBadge status={selected.priority} size="sm" />
            </div>
            <SectionTitle>Job Details</SectionTitle>
            <InfoGrid columns={2}>
              <InfoRow label="Description" value={selected.description} />
              <InfoRow label="Branch" value={selected.branchName} />
              <InfoRow label="Scheduled" value={formatDate(selected.scheduledDate)} />
              <InfoRow label="Completed" value={selected.completedDate ? formatDate(selected.completedDate) : 'In progress'} />
              <InfoRow label="Estimated Hours" value={`${selected.estimatedHours}h`} />
              <InfoRow label="Actual Hours" value={selected.actualHours ? `${selected.actualHours}h` : '—'} />
              <InfoRow label="Bay" value={selected.bayName ?? 'Not assigned'} />
              <InfoRow label="Technician" value={selected.technicianName ?? 'Not assigned'} />
              <InfoRow label="Waiting Days" value={`${daysWaiting(selected.scheduledDate)} days`} />
            </InfoGrid>

            {selected.partsRequired.length > 0 && (
              <>
                <SectionTitle>Parts Required</SectionTitle>
                <div className="space-y-1.5">
                  {selected.partsRequired.map((part, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-md border border-border p-2.5 text-sm">
                      <Package className="h-4 w-4 text-muted-foreground" />
                      <span className="text-foreground">{part}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            <SectionTitle>Timeline</SectionTitle>
            <Timeline events={selected.timeline} compact />
          </div>
        )}
      </SlideOver>

      <UpdateJobStatusDialog 
        open={statusDialogOpen} 
        onClose={() => { setStatusDialogOpen(false); setSelectedJob(null); }} 
        job={selectedJob}
      />

      <AssignTechnicianDialog 
        open={assignDialogOpen} 
        onClose={() => { setAssignDialogOpen(false); setSelectedJob(null); }} 
        job={selectedJob}
      />

      <CreateJobDialog 
        open={createJobOpen} 
        onClose={() => setCreateJobOpen(false)} 
      />

      <JobCardDialog 
        open={jobCardOpen} 
        onClose={() => setJobCardOpen(false)} 
      />
    </div>
  );
}
