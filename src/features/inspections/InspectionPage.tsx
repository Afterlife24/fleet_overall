import { useState, useMemo } from 'react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { SlideOver } from '@/components/common/SlideOver';
import { InfoGrid, InfoRow, SectionTitle } from '@/components/common/InfoGrid';
import { Timeline } from '@/components/common/Timeline';
import { DataTable, type Column } from '@/components/tables/DataTable';
import { useInspectionsByType } from '@/hooks/useQueries';
import { useBranchFilter } from '@/hooks/useBranchFilter';
import { Inspection, InspectionType, ChecklistItem, InspectionStatus } from '@/types/inspection';
import { inspectionSections } from '@/services/mock/inspections';
import { formatDate, formatDateTime } from '@/utils/format';
import { toastSuccess } from '@/lib/toast-helper';
import { cn } from '@/lib/utils';
import { PHIInspectionDialog } from './PHIInspectionDialog';
import { PDIInspectionDialog } from './PDIInspectionDialog';
import { MandatoryChecksDialog } from './MandatoryChecksDialog';
import { MQDDialog } from './MQDDialog';
import {
  Plus, ClipboardCheck, Camera, CheckCircle2, XCircle, MinusCircle,
  Clock, AlertTriangle, FileCheck, PenLine,
} from 'lucide-react';

const TYPE_CONFIG: Record<InspectionType, { title: string; description: string; icon: typeof ClipboardCheck }> = {
  PHI: { title: 'Pre-Hire Inspection', description: 'Complete inspection before machine dispatch to customer', icon: ClipboardCheck },
  PDI: { title: 'Pre-Delivery Inspection', description: 'Quality and regulatory checks before delivery', icon: FileCheck },
  Mandatory: { title: 'Mandatory Checks', description: 'Scheduled mandatory safety inspections', icon: Clock },
  MQD: { title: 'Maintenance Quality Document', description: 'Quality verification of maintenance work', icon: PenLine },
};

const RESULT_ICONS: Record<ChecklistItem['result'], React.ComponentType<{ className?: string }>> = {
  'Pass': CheckCircle2,
  'Fail': XCircle,
  'N/A': MinusCircle,
  'Pending': Clock,
};

const RESULT_COLORS: Record<ChecklistItem['result'], string> = {
  'Pass': 'text-emerald-600 dark:text-emerald-400',
  'Fail': 'text-rose-600 dark:text-rose-400',
  'N/A': 'text-muted-foreground',
  'Pending': 'text-amber-600 dark:text-amber-400',
};

export function InspectionPage({ type }: { type: InspectionType }) {
  const { data: inspections } = useInspectionsByType(type);
  const filtered = useBranchFilter(inspections);
  const [selected, setSelected] = useState<Inspection | null>(null);
  const [phiDialogOpen, setPHIDialogOpen] = useState(false);
  const [pdiDialogOpen, setPDIDialogOpen] = useState(false);
  const [mandatoryDialogOpen, setMandatoryDialogOpen] = useState(false);
  const [mqdDialogOpen, setMQDDialogOpen] = useState(false);
  const config = TYPE_CONFIG[type];

  const stats = useMemo(() => ({
    total: filtered.length,
    pending: filtered.filter((i) => i.status === 'Pending').length,
    inProgress: filtered.filter((i) => i.status === 'In Progress').length,
    passed: filtered.filter((i) => i.status === 'Passed').length,
    failed: filtered.filter((i) => i.status === 'Failed').length,
    awaiting: filtered.filter((i) => i.status === 'Awaiting Approval').length,
  }), [filtered]);

  const columns: Column<Inspection>[] = [
    {
      key: 'reference', header: 'Reference', sortable: true,
      render: (i) => <span className="font-medium text-foreground">{i.reference}</span>,
    },
    {
      key: 'assetNumber', header: 'Machine', sortable: true,
      render: (i) => (
        <div className="flex flex-col">
          <span className="font-medium text-foreground">{i.assetNumber}</span>
          <span className="text-xs text-muted-foreground">{i.machineModel}</span>
        </div>
      ),
    },
    {
      key: 'inspectorName', header: 'Inspector',
      render: (i) => <span className="text-muted-foreground">{i.inspectorName ?? 'Unassigned'}</span>,
    },
    {
      key: 'branchName', header: 'Branch', sortable: true,
      render: (i) => <span className="text-muted-foreground">{i.branchName}</span>,
    },
    {
      key: 'scheduledDate', header: 'Scheduled', sortable: true,
      render: (i) => <span className="text-xs text-muted-foreground">{formatDate(i.scheduledDate)}</span>,
    },
    {
      key: 'status', header: 'Status', sortable: true,
      render: (i) => <StatusBadge status={i.status} size="sm" />,
    },
    {
      key: 'overallResult', header: 'Result',
      render: (i) => i.overallResult ? (
        <span className={cn('inline-flex items-center gap-1 text-xs font-medium', i.overallResult === 'Pass' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
          {i.overallResult === 'Pass' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
          {i.overallResult}
        </span>
      ) : <span className="text-xs text-muted-foreground">—</span>,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={config.title}
        description={config.description}
        actions={
          <Button size="sm" onClick={() => {
            if (type === 'PHI') setPHIDialogOpen(true);
            else if (type === 'PDI') setPDIDialogOpen(true);
            else if (type === 'Mandatory') setMandatoryDialogOpen(true);
            else if (type === 'MQD') setMQDDialogOpen(true);
            else toastSuccess('Form coming soon!');
          }}>
            <Plus className="mr-1.5 h-4 w-4" /> New {type} Inspection
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Card className="p-3"><p className="text-xs text-muted-foreground">Total</p><p className="mt-0.5 text-lg font-semibold">{stats.total}</p></Card>
        <Card className="p-3"><p className="text-xs text-muted-foreground">Pending</p><p className="mt-0.5 text-lg font-semibold text-slate-600 dark:text-slate-400">{stats.pending}</p></Card>
        <Card className="p-3"><p className="text-xs text-muted-foreground">In Progress</p><p className="mt-0.5 text-lg font-semibold text-sky-600 dark:text-sky-400">{stats.inProgress}</p></Card>
        <Card className="p-3"><p className="text-xs text-muted-foreground">Passed</p><p className="mt-0.5 text-lg font-semibold text-emerald-600 dark:text-emerald-400">{stats.passed}</p></Card>
        <Card className="p-3"><p className="text-xs text-muted-foreground">Failed</p><p className="mt-0.5 text-lg font-semibold text-rose-600 dark:text-rose-400">{stats.failed}</p></Card>
        <Card className="p-3"><p className="text-xs text-muted-foreground">Awaiting</p><p className="mt-0.5 text-lg font-semibold text-amber-600 dark:text-amber-400">{stats.awaiting}</p></Card>
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        searchable
        searchPlaceholder="Search by reference, asset, model..."
        searchKeys={['reference', 'assetNumber', 'machineModel', 'inspectorName']}
        onRowClick={(i) => setSelected(i)}
        rowKey={(i) => i.id}
        pageSize={12}
      />

      {/* Inspection Detail */}
      <SlideOver
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? selected.reference : ''}
        description={selected ? `${selected.assetNumber} · ${selected.machineModel}` : ''}
        width="xl"
        footer={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1">Save Draft</Button>
            <Button size="sm" className="flex-1">Submit for Approval</Button>
          </div>
        }
      >
        {selected && <InspectionDetail inspection={selected} />}
      </SlideOver>

      <PHIInspectionDialog open={phiDialogOpen} onClose={() => setPHIDialogOpen(false)} />
      <PDIInspectionDialog open={pdiDialogOpen} onClose={() => setPDIDialogOpen(false)} />
      <MandatoryChecksDialog open={mandatoryDialogOpen} onClose={() => setMandatoryDialogOpen(false)} />
      <MQDDialog open={mqdDialogOpen} onClose={() => setMQDDialogOpen(false)} />
    </div>
  );
}

function InspectionDetail({ inspection }: { inspection: Inspection }) {
  const sections = inspectionSections[inspection.type];
  const checklistBySection = useMemo(() => {
    const map = new Map<string, ChecklistItem[]>();
    for (const section of sections) {
      map.set(section.name, inspection.checklist.filter((c) => c.section === section.name));
    }
    return map;
  }, [inspection.checklist, sections]);

  const passCount = inspection.checklist.filter((c) => c.result === 'Pass').length;
  const failCount = inspection.checklist.filter((c) => c.result === 'Fail').length;
  const totalCount = inspection.checklist.length;

  return (
    <div className="space-y-1">
      <div className="mb-4 flex items-center gap-2">
        <StatusBadge status={inspection.status} />
        {inspection.overallResult && <StatusBadge status={inspection.overallResult === 'Pass' ? 'Passed' : 'Failed'} size="sm" />}
      </div>

      <SectionTitle>Inspection Summary</SectionTitle>
      <InfoGrid columns={3}>
        <InfoRow label="Inspector" value={inspection.inspectorName ?? 'Unassigned'} />
        <InfoRow label="Branch" value={inspection.branchName} />
        <InfoRow label="Scheduled" value={formatDate(inspection.scheduledDate)} />
        <InfoRow label="Completed" value={inspection.completedDate ? formatDate(inspection.completedDate) : 'In progress'} />
        <InfoRow label="Photos" value={<span className="flex items-center gap-1"><Camera className="h-3.5 w-3.5" />{inspection.photoCount}</span>} />
        <InfoRow label="Score" value={`${passCount}/${totalCount} passed`} />
      </InfoGrid>

      {/* Score bar */}
      <div className="my-4 flex h-2 overflow-hidden rounded-full bg-muted">
        <div className="bg-emerald-500" style={{ width: `${(passCount / totalCount) * 100}%` }} />
        <div className="bg-rose-500" style={{ width: `${(failCount / totalCount) * 100}%` }} />
      </div>

      {/* Checklist by section */}
      {sections.map((section) => {
        const items = checklistBySection.get(section.name) ?? [];
        const sectionPass = items.filter((c) => c.result === 'Pass').length;
        return (
          <div key={section.name} className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-sm font-semibold text-foreground">{section.name}</h4>
              <span className="text-xs text-muted-foreground">{sectionPass}/{items.length} passed</span>
            </div>
            <div className="space-y-1.5">
              {items.map((item) => {
                const Icon = RESULT_ICONS[item.result];
                return (
                  <div key={item.id} className={cn(
                    'flex items-start gap-3 rounded-lg border p-3',
                    item.result === 'Fail' ? 'border-rose-200 bg-rose-50/50 dark:border-rose-800 dark:bg-rose-950/20' : 'border-border'
                  )}>
                    <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', RESULT_COLORS[item.result])} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground">{item.question}</p>
                      {item.notes && <p className="mt-0.5 text-xs text-muted-foreground">{item.notes}</p>}
                      {item.critical && (
                        <span className="mt-1 inline-flex items-center gap-0.5 text-[10px] font-semibold text-rose-600 dark:text-rose-400">
                          <AlertTriangle className="h-3 w-3" /> Critical
                        </span>
                      )}
                    </div>
                    <span className={cn('shrink-0 text-xs font-medium', RESULT_COLORS[item.result])}>{item.result}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {inspection.notes && (
        <>
          <SectionTitle>Notes</SectionTitle>
          <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">{inspection.notes}</p>
        </>
      )}

      <SectionTitle>Timeline</SectionTitle>
      <Timeline events={inspection.timeline} compact />
    </div>
  );
}
