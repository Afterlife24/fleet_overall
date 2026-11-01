import { useState, useMemo } from 'react';
import { PageHeader } from '@/components/common/PageHeader';
import { KPICard } from '@/components/common/KPICard';
import { DataTable, type Column } from '@/components/tables/DataTable';
import { SlideOver } from '@/components/common/SlideOver';
import { StatusBadge } from '@/components/common/StatusBadge';
import { InfoGrid, InfoRow, SectionTitle } from '@/components/common/InfoGrid';
import { Timeline } from '@/components/common/Timeline';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DonutChartCard } from '@/components/charts/Charts';
import { LoadingState, ErrorState } from '@/components/common/EmptyState';
import { useCrossHires, useCrossHireStats } from '@/hooks/useQueries';
import { useBranchFilter } from '@/hooks/useBranchFilter';
import { CrossHire, CrossHireStatus, crossHireMargin, crossHireMarginPct } from '@/types/crosshire';
import { formatCurrency, formatDate } from '@/utils/format';
import { cn } from '@/lib/utils';
import { CrossHireFormDialog } from './CrossHireFormDialog';
import { AppOnboarding } from '@/features/apps/AppOnboarding';
import { useAppOnboarding } from '@/hooks/useAppOnboarding';
import {
  Plus, ArrowRightLeft, TrendingUp, Wallet, Building2, Handshake,
  Filter, PhoneCall, MapPin, FileText, Download,
} from 'lucide-react';

const STATUSES: (CrossHireStatus | 'All')[] = ['All', 'Enquiry', 'Confirmed', 'On Hire', 'Off Hire', 'Returned', 'Cancelled'];

function periodLabel(p: CrossHire['ratePeriod']): string {
  return p === 'Day' ? '/day' : p === 'Week' ? '/wk' : '/mo';
}

export function CrossHirePage() {
  const { data: crossHires, isLoading, isError, refetch } = useCrossHires();
  const { data: stats } = useCrossHireStats();
  const scoped = useBranchFilter(crossHires);
  const onboarding = useAppOnboarding('cross_hire', crossHires?.length ?? 0);
  const [statusFilter, setStatusFilter] = useState<CrossHireStatus | 'All'>('All');
  const [selected, setSelected] = useState<CrossHire | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const data = useMemo(
    () => scoped.filter((c) => (statusFilter === 'All' ? true : c.status === statusFilter)),
    [scoped, statusFilter]
  );

  if (isError) return <ErrorState onRetry={() => refetch()} />;

  if (!isLoading && onboarding.showOnboarding) {
    return <AppOnboarding appId="cross_hire" mode={onboarding.mode} onDone={() => { onboarding.dismiss(); refetch(); }} />;
  }

  const columns: Column<CrossHire>[] = [
    {
      key: 'reference', header: 'Reference', sortable: true,
      render: (c) => <span className="font-medium text-foreground">{c.reference}</span>,
    },
    {
      key: 'description', header: 'Equipment', sortable: true, sortAccessor: (c) => `${c.make} ${c.model}`,
      render: (c) => (
        <div className="flex flex-col">
          <span className="font-medium text-foreground">{c.make} {c.model}</span>
          <span className="text-xs text-muted-foreground">{c.description}{c.quantity > 1 ? ` · ×${c.quantity}` : ''}</span>
        </div>
      ),
    },
    {
      key: 'supplierName', header: 'Supplier (IN)', sortable: true,
      render: (c) => (
        <div className="flex flex-col">
          <span className="text-foreground">{c.supplierName}</span>
          <span className="text-xs text-muted-foreground tabular-nums">{formatCurrency(c.buyRate)}{periodLabel(c.ratePeriod)}</span>
        </div>
      ),
    },
    {
      key: 'customerName', header: 'Client (OUT)', sortable: true,
      render: (c) => (
        <div className="flex flex-col">
          <span className="text-foreground">{c.customerName}</span>
          <span className="text-xs text-muted-foreground tabular-nums">{formatCurrency(c.sellRate)}{periodLabel(c.ratePeriod)}</span>
        </div>
      ),
    },
    {
      key: 'margin', header: 'Margin', sortable: true, sortAccessor: (c) => crossHireMargin(c),
      render: (c) => {
        const m = crossHireMargin(c);
        return (
          <div className="flex flex-col">
            <span className={cn('font-semibold tabular-nums', m >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
              {formatCurrency(m)}{periodLabel(c.ratePeriod)}
            </span>
            <span className="text-xs text-muted-foreground">{crossHireMarginPct(c)}% markup</span>
          </div>
        );
      },
    },
    {
      key: 'branchName', header: 'Branch', sortable: true,
      render: (c) => <span className="text-muted-foreground">{c.branchName}</span>,
    },
    {
      key: 'status', header: 'Status', sortable: true,
      render: (c) => <StatusBadge status={c.status} size="sm" />,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Cross Hire"
        description="Equipment rented in from suppliers and re-hired to clients at a margin"
        actions={
          <>
            <Button variant="outline" size="sm"><Download className="mr-1.5 h-4 w-4" /> Export</Button>
            <Button size="sm" onClick={() => setFormOpen(true)}><Plus className="mr-1.5 h-4 w-4" /> New Cross Hire</Button>
          </>
        }
      />

      {/* KPI stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <KPICard label="Active Deals" value={stats?.activeDeals ?? 0} icon={ArrowRightLeft} color="blue" />
        <KPICard label="Units Out" value={stats?.totalUnits ?? 0} icon={Handshake} color="indigo" />
        <KPICard label="Revenue / mo" value={stats ? formatCurrency(stats.monthlyRevenue) : '—'} icon={Wallet} color="teal" />
        <KPICard label="Margin / mo" value={stats ? formatCurrency(stats.monthlyMargin) : '—'} icon={TrendingUp} color="green" />
        <KPICard label="Markup" value={`${stats?.marginPct ?? 0}%`} icon={Building2} color="purple" />
      </div>

      {/* Department / branch-wise breakdown + status split */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-base">Cross Hire by Branch / Department</CardTitle></CardHeader>
          <CardContent>
            {stats?.byBranch?.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="py-2 text-left font-medium">Branch</th>
                      <th className="py-2 text-right font-medium">Deals</th>
                      <th className="py-2 text-right font-medium">Units</th>
                      <th className="py-2 text-right font-medium">Revenue/mo</th>
                      <th className="py-2 text-right font-medium">Cost/mo</th>
                      <th className="py-2 text-right font-medium">Margin/mo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.byBranch.map((b) => (
                      <tr key={b.branch} className="border-b border-border/50 last:border-0">
                        <td className="py-2 font-medium text-foreground">{b.branch}</td>
                        <td className="py-2 text-right tabular-nums">{b.deals}</td>
                        <td className="py-2 text-right tabular-nums">{b.units}</td>
                        <td className="py-2 text-right tabular-nums">{formatCurrency(b.revenue)}</td>
                        <td className="py-2 text-right tabular-nums text-muted-foreground">{formatCurrency(b.cost)}</td>
                        <td className={cn('py-2 text-right font-semibold tabular-nums', b.margin >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                          {formatCurrency(b.margin)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">No cross hire deals in scope.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">By Status</CardTitle></CardHeader>
          <CardContent><DonutChartCard data={stats?.byStatus ?? []} height={220} /></CardContent>
        </Card>
      </div>

      {/* Status filter */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">Status:</span>
        <div className="flex flex-wrap gap-1">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                statusFilter === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? <LoadingState /> : (
        <DataTable
          columns={columns}
          data={data}
          searchable
          searchPlaceholder="Search by reference, supplier, client, equipment..."
          searchKeys={['reference', 'supplierName', 'customerName', 'make', 'model', 'description', 'siteLocation']}
          onRowClick={(c) => setSelected(c)}
          rowKey={(c) => c.id}
          pageSize={15}
        />
      )}

      {/* Detail drawer */}
      <SlideOver
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `${selected.make} ${selected.model}` : ''}
        description={selected ? `${selected.reference} · ${selected.branchName}` : ''}
        width="xl"
      >
        {selected && <CrossHireDetail ch={selected} />}
      </SlideOver>

      <CrossHireFormDialog open={formOpen} onClose={() => setFormOpen(false)} />
    </div>
  );
}

function CrossHireDetail({ ch }: { ch: CrossHire }) {
  const margin = crossHireMargin(ch);
  return (
    <div className="space-y-1">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400">
          <ArrowRightLeft className="h-7 w-7" />
        </div>
        <div>
          <StatusBadge status={ch.status} />
          <p className="mt-1 text-xs text-muted-foreground">{ch.category} · {ch.description}{ch.quantity > 1 ? ` · ×${ch.quantity}` : ''}</p>
        </div>
      </div>

      {/* Margin summary */}
      <div className="mb-2 grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 dark:border-sky-900 dark:bg-sky-950/30">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Buy (IN)</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{formatCurrency(ch.buyRate)}</p>
          <p className="text-xs text-muted-foreground">per {ch.ratePeriod.toLowerCase()}</p>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Sell (OUT)</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{formatCurrency(ch.sellRate)}</p>
          <p className="text-xs text-muted-foreground">per {ch.ratePeriod.toLowerCase()}</p>
        </div>
        <div className={cn('rounded-lg border p-3', margin >= 0 ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30' : 'border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30')}>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Margin</p>
          <p className={cn('mt-1 text-lg font-semibold tabular-nums', margin >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
            {formatCurrency(margin)}
          </p>
          <p className="text-xs text-muted-foreground">{crossHireMarginPct(ch)}% markup{ch.quantity > 1 ? ` · ×${ch.quantity}` : ''}</p>
        </div>
      </div>

      <SectionTitle>Supplier — Rent IN</SectionTitle>
      <InfoGrid columns={2}>
        <InfoRow label="Supplier" value={ch.supplierName} />
        <InfoRow label="Supplier PO" value={ch.supplierPO ?? '—'} />
        <InfoRow label="Contact" value={ch.supplierContact ? (
          <span className="inline-flex items-center gap-1"><PhoneCall className="h-3.5 w-3.5 text-muted-foreground" />{ch.supplierContact}{ch.supplierPhone ? ` · ${ch.supplierPhone}` : ''}</span>
        ) : '—'} />
        <InfoRow label="Supplier Asset No." value={ch.supplierAssetNumber ?? '—'} />
        <InfoRow label="Serial Number" value={ch.serialNumber ?? '—'} />
        <InfoRow label="Buy Rate" value={`${formatCurrency(ch.buyRate)} / ${ch.ratePeriod.toLowerCase()}`} />
      </InfoGrid>

      <SectionTitle>Client — Rent OUT</SectionTitle>
      <InfoGrid columns={2}>
        <InfoRow label="Client" value={ch.customerName} />
        <InfoRow label="Client LPO" value={ch.clientLPO ?? '—'} />
        <InfoRow label="Contact" value={ch.customerContact ?? '—'} />
        <InfoRow label="Site" value={
          <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5 text-muted-foreground" />{ch.siteLocation}</span>
        } />
        <InfoRow label="Sell Rate" value={`${formatCurrency(ch.sellRate)} / ${ch.ratePeriod.toLowerCase()}`} />
        <InfoRow label="Sales Rep" value={ch.salesRep} />
      </InfoGrid>

      <SectionTitle>Hire Period</SectionTitle>
      <InfoGrid columns={3}>
        <InfoRow label="Start Date" value={formatDate(ch.startDate)} />
        <InfoRow label="End Date" value={formatDate(ch.endDate)} />
        <InfoRow label="Expected Return" value={ch.expectedReturnDate ? formatDate(ch.expectedReturnDate) : '—'} />
        <InfoRow label="Quantity" value={ch.quantity} />
        <InfoRow label="Branch" value={ch.branchName} />
        <InfoRow label="Status" value={<StatusBadge status={ch.status} size="sm" />} />
      </InfoGrid>

      {ch.notes && (
        <>
          <SectionTitle>Notes</SectionTitle>
          <div className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm text-foreground">
            <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p>{ch.notes}</p>
          </div>
        </>
      )}

      <SectionTitle>Activity Timeline</SectionTitle>
      {ch.timeline.length ? <Timeline events={ch.timeline} compact /> : (
        <p className="py-4 text-center text-sm text-muted-foreground">No activity recorded.</p>
      )}
    </div>
  );
}
