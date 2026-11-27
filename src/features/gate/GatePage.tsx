import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, LogIn, LogOut, Plus, Search } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SlideOver } from '@/components/common/SlideOver';
import { LoadingState } from '@/components/common/EmptyState';
import { ApiErrorNotice, ApiSessionGate, describeApiError } from '@/components/common/ApiStatus';
import {
  useApproveGatePass, useCan, useCancelGatePass, useCompleteGatePass, useGatePasses,
} from '@/hooks/api/useGateApi';
import { useFleetMachines } from '@/hooks/useApiResources';
import type { GatePassDto } from '@/services/api/gate';
import { PURPOSE_LABEL } from '@/services/api/gateMappers';
import { timeAgo } from '@/utils/format';
import { cn } from '@/lib/utils';
import { toastSuccess } from '@/lib/toast-helper';
import { GatePassDialog } from './GatePassDialog';
import { GatePassPanel } from './GatePassPanel';

export const REOPEN_REQUIRED_MESSAGE =
  'The quotation for this booking is Lost. Reopen the quotation in CRM, then complete this pass again. The machine has not moved.';

/** Gate Operations. Passes, approvals and movements come from `/api/v1/gate-passes`; waits for the API session. */
export function GatePage() {
  return (
    <ApiSessionGate>
      <GateScreen />
    </ApiSessionGate>
  );
}

interface ActionFailure { error: unknown; passId: string | null }

function GateScreen() {
  const passesQuery = useGatePasses();
  const machinesQuery = useFleetMachines();
  const canWrite = useCan('gate.write');
  const canApprove = useCan('gate.approve');
  const approve = useApproveGatePass();
  const complete = useCompleteGatePass();
  const cancel = useCancelGatePass();

  const [tab, setTab] = useState<'entry' | 'exit' | 'log'>('entry');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [cancelling, setCancelling] = useState<GatePassDto | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [failure, setFailure] = useState<ActionFailure | null>(null);

  const passes = passesQuery.data ?? [];
  const selected = passes.find((p) => p.id === selectedId) ?? null;
  const machineById = useMemo(() => new Map((machinesQuery.data ?? []).map((m) => [m.id, m])), [machinesQuery.data]);
  const info = (p: GatePassDto) => {
    const m = machineById.get(p.machineId);
    return { assetNumber: m?.fleetNo ?? m?.assetNumber ?? p.fleetNoSnapshot, model: m ? `${m.make} ${m.model}`.trim() : '', branchName: m?.branchName };
  };

  const data = useMemo(() => {
    let list = passes;
    if (tab === 'entry') list = list.filter((p) => p.direction === 'IN');
    if (tab === 'exit') list = list.filter((p) => p.direction === 'OUT');
    if (tab === 'log') list = list.filter((p) => p.status === 'Completed');
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((p) => {
        const m = info(p);
        return p.fleetNoSnapshot.toLowerCase().includes(q) || m.model.toLowerCase().includes(q)
          || p.driverName.toLowerCase().includes(q) || p.reference.toLowerCase().includes(q);
      });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passes, tab, search, machineById]);

  const pending = passes.filter((p) => p.status === 'Pending').length;
  const inCount = passes.filter((p) => p.direction === 'IN').length;
  const outCount = passes.filter((p) => p.direction === 'OUT').length;

  const reload = () => {
    setFailure(null);
    void passesQuery.refetch();
  };

  const onApprove = (p: GatePassDto) => {
    setFailure(null);
    approve.mutate({ id: p.id, rowVersion: p.rowVersion }, {
      onSuccess: () => toastSuccess(`Gate pass ${p.reference} approved. The machine has not moved yet.`),
      onError: (error) => setFailure({ error, passId: p.id }),
    });
  };

  const onComplete = (p: GatePassDto) => {
    setFailure(null);
    complete.mutate({ id: p.id }, {
      onSuccess: (res) => {
        const base = res.alreadyCompleted ? `Gate pass ${p.reference} was already completed.` : `Gate pass ${p.reference} completed. Movement recorded.`;
        toastSuccess(res.inspection ? `${base} Return intake inspection ${res.inspection.reference} is open on the PHI page.` : base);
      },
      onError: (error) => setFailure({ error, passId: p.id }),
    });
  };

  const onCancelConfirm = () => {
    if (!cancelling || !cancelReason.trim()) return;
    const p = passes.find((x) => x.id === cancelling.id) ?? cancelling;
    setFailure(null);
    cancel.mutate({ id: p.id, rowVersion: p.rowVersion, reason: cancelReason.trim() }, {
      onSuccess: () => {
        toastSuccess(`Gate pass ${p.reference} cancelled`);
        setCancelling(null);
        setCancelReason('');
      },
      onError: (error) => setFailure({ error, passId: p.id }),
    });
  };

  const busyId = (approve.isPending && approve.variables?.id) || (complete.isPending && complete.variables?.id) || null;

  const rowActions = (p: GatePassDto) => (
    <>
      {p.status === 'Pending' && canApprove && (
        <Button size="sm" variant="outline" disabled={busyId === p.id} onClick={() => onApprove(p)}>
          {approve.isPending && approve.variables?.id === p.id ? 'Approving...' : 'Approve'}
        </Button>
      )}
      {p.status === 'Approved' && canWrite && (
        <Button size="sm" disabled={busyId === p.id} onClick={() => onComplete(p)}>
          {complete.isPending && complete.variables?.id === p.id ? 'Completing...' : 'Complete'}
        </Button>
      )}
      {(p.status === 'Pending' || p.status === 'Approved') && canWrite && (p.status === 'Pending' || canApprove) && (
        <Button size="sm" variant="ghost" disabled={busyId === p.id} onClick={() => { setCancelling(p); setCancelReason(''); setFailure(null); }}>
          Cancel
        </Button>
      )}
      {p.status === 'Completed' && <span className="text-xs text-muted-foreground">Done</span>}
      {p.status === 'Cancelled' && <span className="text-xs text-muted-foreground">Cancelled</span>}
    </>
  );

  const failureInfo = failure ? describeApiError(failure.error) : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Gate Operations"
        description="Check-in and check-out processing for fleet movements. A pass does not move the machine until it is approved and completed."
        actions={canWrite ? <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="mr-1.5 h-4 w-4" /> New Gate Pass</Button> : undefined}
      />

      {failure && failureInfo?.code === 'REOPEN_REQUIRED' && (
        <div role="alert" data-testid="reopen-required" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">{REOPEN_REQUIRED_MESSAGE}</p>
          {failureInfo.correlationId && <p className="mt-1 text-xs">Correlation ID: <span className="font-mono">{failureInfo.correlationId}</span></p>}
          <Link to="/crm" className="mt-1 inline-block text-xs underline">Open CRM</Link>
        </div>
      )}
      {failure && failureInfo?.code !== 'REOPEN_REQUIRED' && failure.passId !== cancelling?.id && (
        <ApiErrorNotice error={failure.error} onReload={reload} reloading={passesQuery.isFetching} />
      )}
      {passesQuery.isError && <ApiErrorNotice error={passesQuery.error} onRetry={() => void passesQuery.refetch()} />}

      <div className="grid grid-cols-3 gap-3">
        <Card className="p-4">
          <div className="flex items-center gap-2"><Clock className="h-4 w-4 text-amber-500" /><p className="text-xs uppercase tracking-wider text-muted-foreground">Pending</p></div>
          <p className="mt-1 text-xl font-semibold text-amber-600 dark:text-amber-400">{pending}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2"><LogIn className="h-4 w-4 text-emerald-500" /><p className="text-xs uppercase tracking-wider text-muted-foreground">Check-ins</p></div>
          <p className="mt-1 text-xl font-semibold">{inCount}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2"><LogOut className="h-4 w-4 text-sky-500" /><p className="text-xs uppercase tracking-wider text-muted-foreground">Check-outs</p></div>
          <p className="mt-1 text-xl font-semibold">{outCount}</p>
        </Card>
      </div>

      <div className="flex w-fit gap-1 rounded-lg bg-muted p-1">
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

      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search asset, model, driver..."
          className="h-9 w-full rounded-md border border-input bg-transparent pl-9 pr-3 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/30">
              <tr>
                {['Reference', 'Machine', 'Direction', 'Purpose', 'Driver', 'Destination / Source', tab === 'log' ? 'Crossed' : 'Requested', 'Status'].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">{h}</th>
                ))}
                <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Action</th>
              </tr>
            </thead>
            <tbody>
              {passesQuery.isLoading ? (
                <tr><td colSpan={9} className="py-12 text-center text-sm text-muted-foreground"><LoadingState /></td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={9} className="py-12 text-center text-sm text-muted-foreground">No entries found</td></tr>
              ) : (
                data.map((p) => {
                  const m = info(p);
                  return (
                    <tr key={p.id} onClick={() => setSelectedId(p.id)} className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-muted/20">
                      <td className="px-4 py-3 font-medium text-foreground">{p.reference}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <span className="font-medium text-foreground">{m.assetNumber}</span>
                          <span className="text-xs text-muted-foreground">{m.model}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium',
                          p.direction === 'IN' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400' : 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400',
                        )}>
                          {p.direction === 'IN' ? <LogIn className="h-3 w-3" /> : <LogOut className="h-3 w-3" />}
                          {p.direction}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{PURPOSE_LABEL[p.movementPurpose]}</td>
                      <td className="px-4 py-3 text-muted-foreground">{p.driverName}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{p.direction === 'IN' ? (p.arrivingFrom ?? p.destination) : p.destination}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{timeAgo(tab === 'log' && p.movement ? p.movement.occurredAt : p.requestedAt)}</td>
                      <td className="px-4 py-3"><StatusBadge status={p.status} size="sm" /></td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1">{rowActions(p)}</div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <SlideOver
        open={!!selected}
        onClose={() => setSelectedId(null)}
        title={selected ? selected.reference : ''}
        description={selected ? `${info(selected).assetNumber} · ${info(selected).model}` : ''}
        width="md"
      >
        {selected && <GatePassPanel key={selected.id} pass={selected} machine={info(selected)} actions={rowActions(selected)} />}
      </SlideOver>

      <GatePassDialog open={createOpen} onClose={() => setCreateOpen(false)} onOpenPass={(id) => setSelectedId(id)} />

      <Dialog open={!!cancelling} onOpenChange={(o) => { if (!o) setCancelling(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel gate pass {cancelling?.reference}</DialogTitle>
            <DialogDescription>The pass will be closed. Nothing has moved, so no machine or booking changes.</DialogDescription>
          </DialogHeader>
          <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Reason (required)" rows={3} aria-label="Cancel reason" />
          {failure && failure.passId === cancelling?.id && <ApiErrorNotice error={failure.error} onReload={reload} reloading={passesQuery.isFetching} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelling(null)}>Keep pass</Button>
            <Button disabled={!cancelReason.trim() || cancel.isPending} onClick={onCancelConfirm}>
              {cancel.isPending ? 'Cancelling...' : 'Cancel pass'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
