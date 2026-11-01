import { useState, useMemo } from 'react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/common/StatusBadge';
import { SlideOver } from '@/components/common/SlideOver';
import { InfoGrid, InfoRow, SectionTitle } from '@/components/common/InfoGrid';
import { Timeline } from '@/components/common/Timeline';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/tables/DataTable';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBreakdowns, useTechnicians } from '@/hooks/useQueries';
import { useBranchFilter } from '@/hooks/useBranchFilter';
import { Breakdown, BreakdownStatus, BreakdownSeverity } from '@/types/breakdown';
import { formatDateTime, formatDate, formatNumber } from '@/utils/format';
import { cn } from '@/lib/utils';
import { toastSuccess } from '@/lib/toast-helper';
import { useAppStore } from '@/store/appStore';
import { ReportBreakdownDialog } from './ReportBreakdownDialog';
import { AlertTriangle, Plus, Wrench, MapPin, User, Clock, CheckCircle2, FileWarning } from 'lucide-react';

const STATUSES: (BreakdownStatus | 'All')[] = ['All', 'Open', 'Assigned', 'In Progress', 'Resolved', 'Closed'];
const SEVERITIES: (BreakdownSeverity | 'All')[] = ['All', 'Low', 'Medium', 'High', 'Critical'];

export function BreakdownsPage() {
  const { data: breakdowns } = useBreakdowns();
  const { data: technicians } = useTechnicians();
  const filtered = useBranchFilter(breakdowns);
  const [selected, setSelected] = useState<Breakdown | null>(null);
  const [statusFilter, setStatusFilter] = useState<BreakdownStatus | 'All'>('All');
  const [severityFilter, setSeverityFilter] = useState<BreakdownSeverity | 'All'>('All');
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [assigningTech, setAssigningTech] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const { updateBreakdown } = useAppStore();

  const data = useMemo(() => {
    return filtered.filter((b) => {
      if (statusFilter !== 'All' && b.status !== statusFilter) return false;
      if (severityFilter !== 'All' && b.severity !== severityFilter) return false;
      return true;
    });
  }, [filtered, statusFilter, severityFilter]);

  const stats = useMemo(() => ({
    open: filtered.filter((b) => b.status === 'Open').length,
    inProgress: filtered.filter((b) => b.status === 'In Progress' || b.status === 'Assigned').length,
    resolved: filtered.filter((b) => b.status === 'Resolved' || b.status === 'Closed').length,
    critical: filtered.filter((b) => b.severity === 'Critical' && b.status !== 'Closed').length,
  }), [filtered]);

  const columns: Column<Breakdown>[] = [
    { key: 'reference', header: 'Reference', sortable: true, render: (b) => <span className="font-medium text-foreground">{b.reference}</span> },
    {
      key: 'assetNumber', header: 'Machine', sortable: true,
      render: (b) => (
        <div className="flex flex-col">
          <span className="font-medium text-foreground">{b.assetNumber}</span>
          <span className="text-xs text-muted-foreground">{b.machineModel}</span>
        </div>
      ),
    },
    { key: 'severity', header: 'Severity', sortable: true, render: (b) => <StatusBadge status={b.severity} size="sm" /> },
    { key: 'status', header: 'Status', sortable: true, render: (b) => <StatusBadge status={b.status} size="sm" /> },
    { key: 'location', header: 'Location', render: (b) => <span className="text-xs text-muted-foreground">{b.location}</span> },
    { key: 'technicianName', header: 'Technician', render: (b) => <span className="text-muted-foreground">{b.technicianName ?? 'Unassigned'}</span> },
    { key: 'reportedAt', header: 'Reported', sortable: true, render: (b) => <span className="text-xs text-muted-foreground">{formatDate(b.reportedAt)}</span> },
    {
      key: 'downtimeHours', header: 'Downtime', sortable: true,
      render: (b) => b.downtimeHours ? <span className="text-xs font-medium text-amber-600 dark:text-amber-400">{b.downtimeHours}h</span> : <span className="text-xs text-muted-foreground">—</span>,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Breakdowns"
        description="Open cases, technician assignments, and resolution tracking"
        actions={<Button size="sm" onClick={() => setReportDialogOpen(true)}><Plus className="mr-1.5 h-4 w-4" /> Report Breakdown</Button>}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-rose-500" /><p className="text-xs text-muted-foreground uppercase tracking-wider">Open</p></div>
          <p className="mt-1 text-xl font-semibold text-rose-600 dark:text-rose-400">{stats.open}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2"><Wrench className="h-4 w-4 text-amber-500" /><p className="text-xs text-muted-foreground uppercase tracking-wider">In Progress</p></div>
          <p className="mt-1 text-xl font-semibold text-amber-600 dark:text-amber-400">{stats.inProgress}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" /><p className="text-xs text-muted-foreground uppercase tracking-wider">Resolved</p></div>
          <p className="mt-1 text-xl font-semibold text-emerald-600 dark:text-emerald-400">{stats.resolved}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-rose-600" /><p className="text-xs text-muted-foreground uppercase tracking-wider">Critical</p></div>
          <p className="mt-1 text-xl font-semibold text-rose-600 dark:text-rose-400">{stats.critical}</p>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium text-muted-foreground">Status:</span>
        <div className="flex flex-wrap gap-1">
          {STATUSES.map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)} className={cn('rounded-md px-2.5 py-1 text-xs font-medium transition-colors', statusFilter === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent')}>{s}</button>
          ))}
        </div>
        <span className="ml-3 text-xs font-medium text-muted-foreground">Severity:</span>
        <div className="flex flex-wrap gap-1">
          {SEVERITIES.map((s) => (
            <button key={s} onClick={() => setSeverityFilter(s)} className={cn('rounded-md px-2.5 py-1 text-xs font-medium transition-colors', severityFilter === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent')}>{s}</button>
          ))}
        </div>
      </div>

      <DataTable
        columns={columns}
        data={data}
        searchable
        searchPlaceholder="Search by reference, asset, location..."
        searchKeys={['reference', 'assetNumber', 'machineModel', 'location', 'customerName']}
        onRowClick={(b) => setSelected(b)}
        rowKey={(b) => b.id}
        pageSize={12}
      />

      {/* Detail */}
      <SlideOver
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? selected.reference : ''}
        description={selected ? `${selected.assetNumber} · ${selected.machineModel}` : ''}
        width="lg"
        footer={
          selected && (
            <div className="space-y-2">
              {/* Assign Technician */}
              <div className="flex items-center gap-2">
                <Select
                  disabled={assigningTech}
                  onValueChange={(techId) => {
                    if (!selected) return;
                    setAssigningTech(true);
                    const tech = technicians?.find(t => t.id === techId);
                    updateBreakdown(selected.id, {
                      technicianId: techId,
                      technicianName: tech?.name ?? techId,
                      status: 'Assigned',
                    });
                    toastSuccess(`Technician ${tech?.name} assigned`);
                    setAssigningTech(false);
                    setSelected({ ...selected, technicianId: techId, technicianName: tech?.name ?? techId, status: 'Assigned' });
                  }}
                >
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Assign Technician..." /></SelectTrigger>
                  <SelectContent>
                    {technicians?.map(t => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
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
                    updateBreakdown(selected.id, { status: newStatus as BreakdownStatus });
                    toastSuccess(`Status updated to ${newStatus}`);
                    setUpdatingStatus(false);
                    setSelected({ ...selected, status: newStatus as BreakdownStatus });
                  }}
                >
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Update Status..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Open">Open</SelectItem>
                    <SelectItem value="Assigned">Assigned</SelectItem>
                    <SelectItem value="In Progress">In Progress</SelectItem>
                    <SelectItem value="Resolved">Resolved</SelectItem>
                    <SelectItem value="Closed">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )
        }
      >
        {selected && (
          <div className="space-y-1">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <StatusBadge status={selected.status} />
              <StatusBadge status={selected.severity} size="sm" />
              {selected.hasDamageClaim && (
                <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                  <FileWarning className="h-3 w-3" /> Damage Claim
                </span>
              )}
            </div>

            <SectionTitle>Breakdown Details</SectionTitle>
            <InfoGrid columns={2}>
              <InfoRow label="Client" value={(selected as any).client ?? selected.customerName ?? 'Internal'} />
              <InfoRow label="EqptNo" value={(selected as any).eqptNo ?? selected.assetNumber} />
              <InfoRow label="BreakdownDetails" value={(selected as any).breakdownDetails ?? selected.description} />
              <InfoRow label="BD_ReportedDate" value={(selected as any).bdReportedDate ?? ''} />
              <InfoRow label="BD_ReportedTime" value={(selected as any).bdReportedTime ?? ''} />
              <InfoRow label="Engineer" value={(selected as any).engineer ?? selected.technicianName ?? 'Unassigned'} />
              <InfoRow label="CompletionDate" value={(selected as any).completionDate ?? ''} />
              <InfoRow label="Engineer_CompletionTime" value={(selected as any).engineerCompletionTime ?? ''} />
            </InfoGrid>

            {((selected as any).machineNotes || (selected as any).actualWorkDone) && (
              <>
                <SectionTitle>Technical Details</SectionTitle>
                <InfoGrid columns={2}>
                  {(selected as any).machineNotes && <InfoRow label="MachineNotes" value={(selected as any).machineNotes} />}
                  {(selected as any).actualWorkDone && <InfoRow label="ActualWorkDone" value={(selected as any).actualWorkDone} />}
                </InfoGrid>
              </>
            )}

            {(selected as any).faultAttribution && (
              <>
                <SectionTitle>Fault Attribution (§9.3)</SectionTitle>
                <InfoGrid columns={2}>
                  <InfoRow label="Attribution" value={(selected as any).faultAttribution} />
                  <InfoRow label="Severity" value={selected.severity} />
                  <InfoRow label="Site Contact" value={(selected as any).siteContactName ?? '—'} />
                  <InfoRow label="Contact Phone" value={(selected as any).siteContactPhone ?? '—'} />
                </InfoGrid>
              </>
            )}

            {selected.technicianName && (
              <>
                <SectionTitle>Technician Assignment</SectionTitle>
                <div className="flex items-center gap-3 rounded-lg border border-border p-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-950/40">
                    <User className="h-5 w-5 text-sky-600 dark:text-sky-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{selected.technicianName}</p>
                    <p className="text-xs text-muted-foreground">Assigned technician</p>
                  </div>
                </div>
              </>
            )}

            {selected.resolution && (
              <>
                <SectionTitle>Resolution</SectionTitle>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-800 dark:bg-emerald-950/20">
                  <p className="text-sm text-foreground">{selected.resolution}</p>
                  {selected.resolvedAt && <p className="mt-1 text-xs text-muted-foreground">Resolved: {formatDateTime(selected.resolvedAt)}</p>}
                  {selected.downtimeHours && <p className="text-xs text-muted-foreground">Total downtime: {selected.downtimeHours}h</p>}
                </div>
              </>
            )}

            {selected.partsUsed && selected.partsUsed.length > 0 && (
              <>
                <SectionTitle>Parts Used</SectionTitle>
                <div className="flex flex-wrap gap-1.5">
                  {selected.partsUsed.map((part, i) => (
                    <span key={i} className="rounded-md border border-border bg-muted px-2 py-1 text-xs text-foreground">{part}</span>
                  ))}
                </div>
              </>
            )}

            <SectionTitle>Timeline</SectionTitle>
            <Timeline events={selected.timeline} compact />
          </div>
        )}
      </SlideOver>

      <ReportBreakdownDialog 
        open={reportDialogOpen} 
        onClose={() => setReportDialogOpen(false)} 
      />
    </div>
  );
}
