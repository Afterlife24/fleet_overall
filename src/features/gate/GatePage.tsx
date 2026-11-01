import { useState, useMemo } from 'react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { SlideOver } from '@/components/common/SlideOver';
import { InfoGrid, InfoRow, SectionTitle } from '@/components/common/InfoGrid';
import { useGateEntries, useApproveGateEntry, useCompleteGateEntry } from '@/hooks/useQueries';
import { useBranchFilter } from '@/hooks/useBranchFilter';
import { GateEntry } from '@/types/gate';
import { formatDateTime, timeAgo } from '@/utils/format';
import { cn } from '@/lib/utils';
import { toastSuccess, toastError } from '@/lib/toast-helper';
import { GatePassDialog } from './GatePassDialog';
import { LogIn, LogOut, Plus, Search, Clock, MapPin, FileText, Truck, User, Package } from 'lucide-react';

export function GatePage() {
  const { data: entries, isLoading } = useGateEntries();
  const filteredEntries = useBranchFilter(entries);
  const [tab, setTab] = useState<'entry' | 'exit' | 'log'>('entry');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<GateEntry | null>(null);
  const [createPassOpen, setCreatePassOpen] = useState(false);

  const approveMutation = useApproveGateEntry();
  const completeMutation = useCompleteGateEntry();

  const handleApprove = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await approveMutation.mutateAsync(id);
      toastSuccess('Gate entry approved successfully');
    } catch (error) {
      toastError('Failed to approve gate entry');
    }
  };

  const handleComplete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await completeMutation.mutateAsync(id);
      toastSuccess('Gate entry completed successfully');
      setSelected(null);
    } catch (error) {
      toastError('Failed to complete gate entry');
    }
  };

  const data = useMemo(() => {
    if (!filteredEntries) return [];
    let list = filteredEntries;
    if (tab === 'entry') list = list.filter((e) => e.direction === 'IN');
    if (tab === 'exit') list = list.filter((e) => e.direction === 'OUT');
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((e) =>
        e.assetNumber.toLowerCase().includes(q) ||
        e.machineModel.toLowerCase().includes(q) ||
        e.driver.toLowerCase().includes(q) ||
        e.reference.toLowerCase().includes(q)
      );
    }
    return list;
  }, [filteredEntries, tab, search]);

  const pending = filteredEntries.filter((e) => e.status === 'Pending').length;
  const inCount = filteredEntries.filter((e) => e.direction === 'IN').length;
  const outCount = filteredEntries.filter((e) => e.direction === 'OUT').length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Gate Operations"
        description="Check-in and check-out processing for fleet movements"
        actions={<Button size="sm" onClick={() => setCreatePassOpen(true)}><Plus className="mr-1.5 h-4 w-4" /> New Gate Pass</Button>}
      />

      <div className="grid grid-cols-3 gap-3">
        <Card className="p-4">
          <div className="flex items-center gap-2"><Clock className="h-4 w-4 text-amber-500" /><p className="text-xs text-muted-foreground uppercase tracking-wider">Pending</p></div>
          <p className="mt-1 text-xl font-semibold text-amber-600 dark:text-amber-400">{pending}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2"><LogIn className="h-4 w-4 text-emerald-500" /><p className="text-xs text-muted-foreground uppercase tracking-wider">Check-ins</p></div>
          <p className="mt-1 text-xl font-semibold">{inCount}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2"><LogOut className="h-4 w-4 text-sky-500" /><p className="text-xs text-muted-foreground uppercase tracking-wider">Check-outs</p></div>
          <p className="mt-1 text-xl font-semibold">{outCount}</p>
        </Card>
      </div>

      <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
        {(['entry', 'exit', 'log'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn('flex-1 rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors', tab === t ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
          >
            {t === 'entry' ? 'Gate Entry' : t === 'exit' ? 'Gate Exit' : 'Movement Log'}
          </button>
        ))}
      </div>

      {tab !== 'log' && (
        <div className="relative max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search asset, model, driver..."
            className="h-9 w-full rounded-md border border-input bg-transparent pl-9 pr-3 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
      )}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/30">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Reference</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Machine</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Direction</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Driver</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Destination / Source</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Time</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Action</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={8} className="py-12 text-center text-sm text-muted-foreground">Loading gate entries...</td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={8} className="py-12 text-center text-sm text-muted-foreground">No entries found</td></tr>
              ) : (
                data.map((entry) => (
                  <tr
                    key={entry.id}
                    onClick={() => setSelected(entry)}
                    className="cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-muted/20"
                  >
                    <td className="px-4 py-3 font-medium text-foreground">{entry.reference}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">{entry.assetNumber}</span>
                        <span className="text-xs text-muted-foreground">{entry.machineModel}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium',
                        entry.direction === 'IN' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400' : 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400'
                      )}>
                        {entry.direction === 'IN' ? <LogIn className="h-3 w-3" /> : <LogOut className="h-3 w-3" />}
                        {entry.direction}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{entry.driver}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{entry.destination}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{timeAgo(entry.timestamp)}</td>
                    <td className="px-4 py-3"><StatusBadge status={entry.status} size="sm" /></td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      {entry.status === 'Pending' && (
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={(e) => handleApprove(entry.id, e)}
                          disabled={approveMutation.isPending}
                        >
                          {approveMutation.isPending ? 'Approving...' : 'Approve'}
                        </Button>
                      )}
                      {entry.status === 'Approved' && (
                        <Button 
                          size="sm"
                          onClick={(e) => handleComplete(entry.id, e)}
                          disabled={completeMutation.isPending}
                        >
                          {completeMutation.isPending ? 'Completing...' : 'Complete'}
                        </Button>
                      )}
                      {entry.status === 'Completed' && <span className="text-xs text-muted-foreground">Done</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <SlideOver
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? selected.reference : ''}
        description={selected ? `${selected.assetNumber} · ${selected.machineModel}` : ''}
        width="md"
        footer={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1">Print Gate Pass</Button>
            <Button size="sm" className="flex-1">Process Entry</Button>
          </div>
        }
      >
        {selected && (
          <div className="space-y-1">
            <div className="mb-4 flex items-center gap-2">
              <StatusBadge status={selected.status} />
              <span className={cn(
                'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium',
                selected.direction === 'IN' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400' : 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400'
              )}>
                {selected.direction === 'IN' ? <LogIn className="h-3 w-3" /> : <LogOut className="h-3 w-3" />}
                {selected.direction === 'IN' ? 'Check-in' : 'Check-out'}
              </span>
            </div>
            <SectionTitle>Gate Entry Details (REF-06)</SectionTitle>
            <InfoGrid columns={2}>
              <InfoRow label="Fleet No. (EqptNo)" value={selected.assetNumber} />
              <InfoRow label="Truck Plate" value={(selected as any).truckPlate ?? '—'} />
              <InfoRow label="Arriving From" value={(selected as any).arrivingFrom ?? selected.destination} />
              <InfoRow label="Direction" value={selected.direction === 'IN' ? 'IN — Machine arriving' : 'OUT — Machine departing'} />
              <InfoRow label="Gate Pass" value={selected.gatePass} />
              <InfoRow label="Driver" value={selected.driver} />
              <InfoRow label="Branch" value={selected.branchName} />
              <InfoRow label="Timestamp" value={formatDateTime(selected.timestamp)} />
            </InfoGrid>
            {selected.notes && (
              <>
                <SectionTitle>Notes</SectionTitle>
                <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">{selected.notes}</p>
              </>
            )}
          </div>
        )}
      </SlideOver>

      <GatePassDialog 
        open={createPassOpen} 
        onClose={() => setCreatePassOpen(false)} 
      />
    </div>
  );
}
