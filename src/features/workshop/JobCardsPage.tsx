import { useState } from 'react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/common/StatusBadge';
import { SlideOver } from '@/components/common/SlideOver';
import { InfoGrid, InfoRow, SectionTitle } from '@/components/common/InfoGrid';
import { Timeline } from '@/components/common/Timeline';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/tables/DataTable';
import { useJobCards } from '@/hooks/useQueries';
import { useBranchFilter } from '@/hooks/useBranchFilter';
import { JobCard } from '@/types/jobcard';
import { formatCurrency, formatDate } from '@/utils/format';
import { JobCardDialog } from './JobCardDialog';
import { Plus, FileText, Wrench } from 'lucide-react';

export function JobCardsPage() {
  const { data: jobCards } = useJobCards();
  const filtered = useBranchFilter(jobCards);
  const [selected, setSelected] = useState<JobCard | null>(null);
  const [jobCardDialogOpen, setJobCardDialogOpen] = useState(false);

  const columns: Column<JobCard>[] = [
    { key: 'reference', header: 'Reference', sortable: true, render: (j) => <span className="font-medium text-foreground">{j.reference}</span> },
    {
      key: 'assetNumber', header: 'Machine', sortable: true,
      render: (j) => (
        <div className="flex flex-col">
          <span className="font-medium text-foreground">{j.assetNumber}</span>
          <span className="text-xs text-muted-foreground">{j.machineModel}</span>
        </div>
      ),
    },
    { key: 'technicianName', header: 'Technician', render: (j) => <span className="text-muted-foreground">{j.technicianName}</span> },
    { key: 'branchName', header: 'Branch', sortable: true, render: (j) => <span className="text-muted-foreground">{j.branchName}</span> },
    { key: 'laborHours', header: 'Hours', sortable: true, render: (j) => <span className="tabular-nums text-muted-foreground">{j.laborHours}h</span> },
    { key: 'totalCost', header: 'Total Cost', sortable: true, render: (j) => <span className="font-medium tabular-nums">{formatCurrency(j.totalCost)}</span> },
    { key: 'status', header: 'Status', sortable: true, render: (j) => <StatusBadge status={j.status} size="sm" /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Job Cards"
        description="Workshop job cards with parts and labor tracking"
        actions={<Button size="sm" onClick={() => setJobCardDialogOpen(true)}><Plus className="mr-1.5 h-4 w-4" /> New Job Card</Button>}
      />

      <DataTable
        columns={columns}
        data={filtered}
        searchable
        searchPlaceholder="Search by reference, asset, technician..."
        searchKeys={['reference', 'assetNumber', 'machineModel', 'technicianName']}
        onRowClick={(j) => setSelected(j)}
        rowKey={(j) => j.id}
        pageSize={12}
      />

      <SlideOver
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? selected.reference : ''}
        description={selected ? `${selected.assetNumber} · ${selected.machineModel}` : ''}
        width="lg"
        footer={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1">Print</Button>
            <Button size="sm" className="flex-1">Update</Button>
          </div>
        }
      >
        {selected && (
          <div className="space-y-1">
            <div className="mb-4"><StatusBadge status={selected.status} /></div>
            <SectionTitle>Job Card Details</SectionTitle>
            <InfoGrid columns={2}>
              <InfoRow label="Description" value={selected.description} />
              <InfoRow label="Branch" value={selected.branchName} />
              <InfoRow label="Technician" value={selected.technicianName} />
              <InfoRow label="Opened" value={formatDate(selected.openedAt)} />
              <InfoRow label="Closed" value={selected.closedAt ? formatDate(selected.closedAt) : 'Open'} />
              <InfoRow label="Labor Hours" value={`${selected.laborHours}h`} />
            </InfoGrid>

            <SectionTitle>Parts & Materials</SectionTitle>
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Description</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Qty</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Unit Cost</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.items.map((item) => (
                    <tr key={item.id} className="border-t border-border">
                      <td className="px-3 py-2 text-foreground">{item.description}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{item.quantity}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatCurrency(item.unitCost)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{formatCurrency(item.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-border bg-muted/20">
                  <tr>
                    <td colSpan={3} className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Labor Cost</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{formatCurrency(selected.laborCost)}</td>
                  </tr>
                  <tr className="border-t border-border">
                    <td colSpan={3} className="px-3 py-2 text-right text-sm font-semibold text-foreground">Total</td>
                    <td className="px-3 py-2 text-right tabular-nums text-sm font-bold text-foreground">{formatCurrency(selected.totalCost)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <SectionTitle>Timeline</SectionTitle>
            <Timeline events={selected.timeline} compact />
          </div>
        )}
      </SlideOver>

      <JobCardDialog 
        open={jobCardDialogOpen} 
        onClose={() => setJobCardDialogOpen(false)} 
      />
    </div>
  );
}
