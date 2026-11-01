import { useState } from 'react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Button } from '@/components/ui/button';
import { AreaChartCard, LineChartCard, GroupedBarChartCard, DonutChartCard, BarChartCard } from '@/components/charts/Charts';
import { DataTable, type Column } from '@/components/tables/DataTable';
import { useReportSummary, useRevenueTrend, useBranchPerformance, useWorkshopReport, useTransportReport, useBreakdownReport, useCrossHireStats } from '@/hooks/useQueries';
import { formatCurrency } from '@/utils/format';
import { BranchPerformance } from '@/types/report';
import { cn } from '@/lib/utils';
import { Download, TrendingUp, DollarSign, Percent, AlertTriangle, Clock, CheckCircle2, ArrowRightLeft } from 'lucide-react';

type Period = 'daily' | 'weekly' | 'monthly';

const PERIODS: { label: string; value: Period }[] = [
  { label: 'Daily', value: 'daily' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'Monthly', value: 'monthly' },
];

export function ReportsPage() {
  const [period, setPeriod] = useState<Period>('weekly');
  const { data: summary } = useReportSummary(period);
  const { data: revenue } = useRevenueTrend(period);
  const { data: branchPerf } = useBranchPerformance();
  const { data: wsReport } = useWorkshopReport();
  const { data: trReport } = useTransportReport();
  const { data: bdReport } = useBreakdownReport();
  const { data: chStats } = useCrossHireStats();

  const branchColumns: Column<BranchPerformance>[] = [
    { key: 'branch', header: 'Branch', sortable: true, render: (r) => <span className="font-medium text-foreground">{r.branch}</span> },
    { key: 'machines', header: 'Machines', sortable: true, render: (r) => <span className="tabular-nums">{r.machines}</span> },
    { key: 'utilization', header: 'Utilization', sortable: true, render: (r) => <span className="tabular-nums">{r.utilization}%</span> },
    { key: 'revenue', header: 'Revenue', sortable: true, render: (r) => <span className="tabular-nums font-medium">{formatCurrency(r.revenue)}</span> },
    { key: 'breakdowns', header: 'Breakdowns', sortable: true, render: (r) => <span className="tabular-nums text-rose-600 dark:text-rose-400">{r.breakdowns}</span> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports & Analytics"
        description="Fleet performance metrics and operational insights"
        actions={
          <>
            <Button variant="outline" size="sm"><Download className="mr-1.5 h-4 w-4" /> Export PDF</Button>
            <Button variant="outline" size="sm"><Download className="mr-1.5 h-4 w-4" /> Export Excel</Button>
          </>
        }
      />

      {/* Period selector */}
      <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
        {PERIODS.map((p) => (
          <button
            key={p.value}
            onClick={() => setPeriod(p.value)}
            className={cn('rounded-md px-4 py-1.5 text-sm font-medium capitalize transition-colors', period === p.value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Card className="p-4">
          <div className="flex items-center gap-1.5 text-muted-foreground"><DollarSign className="h-4 w-4" /><p className="text-xs uppercase tracking-wider">Revenue</p></div>
          <p className="mt-1 text-xl font-semibold">{summary ? formatCurrency(summary.totalRevenue) : '—'}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-1.5 text-muted-foreground"><Percent className="h-4 w-4" /><p className="text-xs uppercase tracking-wider">Utilization</p></div>
          <p className="mt-1 text-xl font-semibold">{summary?.utilizationRate ?? 0}%</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-1.5 text-muted-foreground"><TrendingUp className="h-4 w-4" /><p className="text-xs uppercase tracking-wider">Hires</p></div>
          <p className="mt-1 text-xl font-semibold">{summary?.totalHires ?? 0}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-1.5 text-muted-foreground"><AlertTriangle className="h-4 w-4" /><p className="text-xs uppercase tracking-wider">Breakdowns</p></div>
          <p className="mt-1 text-xl font-semibold text-rose-600 dark:text-rose-400">{summary?.totalBreakdowns ?? 0}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-1.5 text-muted-foreground"><Clock className="h-4 w-4" /><p className="text-xs uppercase tracking-wider">Avg Repair</p></div>
          <p className="mt-1 text-xl font-semibold">{summary?.avgRepairTime ?? 0}h</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-1.5 text-muted-foreground"><CheckCircle2 className="h-4 w-4" /><p className="text-xs uppercase tracking-wider">Availability</p></div>
          <p className="mt-1 text-xl font-semibold text-emerald-600 dark:text-emerald-400">{summary?.fleetAvailability ?? 0}%</p>
        </Card>
      </div>

      {/* Revenue & Hires Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Revenue Trend ({period})</CardTitle></CardHeader>
          <CardContent><AreaChartCard data={revenue ?? []} color="#0ea5e9" height={260} dataKey="revenue" /></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Hire Volume ({period})</CardTitle></CardHeader>
          <CardContent><AreaChartCard data={revenue ?? []} color="#10b981" height={260} dataKey="hires" /></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Revenue vs Hires Comparison</CardTitle></CardHeader>
        <CardContent><LineChartCard data={revenue ?? []} keys={['revenue', 'hires']} colors={['#0ea5e9', '#10b981']} height={280} /></CardContent>
      </Card>

      {/* Workshop Report Section */}
      <div className="pt-2">
        <h2 className="mb-3 text-lg font-semibold text-foreground">Workshop Performance</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 mb-4">
          <Card className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Jobs Completed</p>
            <p className="mt-1 text-xl font-semibold text-emerald-600 dark:text-emerald-400">{wsReport?.jobsCompleted ?? 0}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Jobs Open</p>
            <p className="mt-1 text-xl font-semibold text-amber-600 dark:text-amber-400">{wsReport?.jobsOpen ?? 0}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Avg Repair Days</p>
            <p className="mt-1 text-xl font-semibold">{wsReport?.avgRepairDays ?? 0}d</p>
          </Card>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Workshop Throughput</CardTitle></CardHeader>
            <CardContent><GroupedBarChartCard data={wsReport?.throughput ?? []} keys={['completed', 'intake']} colors={['#0ea5e9', '#f59e0b']} height={240} /></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Jobs by Status</CardTitle></CardHeader>
            <CardContent><DonutChartCard data={wsReport?.byStatus ?? []} height={240} /></CardContent>
          </Card>
        </div>
      </div>

      {/* Transport Report Section */}
      <div className="pt-2">
        <h2 className="mb-3 text-lg font-semibold text-foreground">Transport Report</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 mb-4">
          <Card className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Distance</p>
            <p className="mt-1 text-xl font-semibold">{trReport?.totalDistance ?? 0} km</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Completed Today</p>
            <p className="mt-1 text-xl font-semibold text-emerald-600 dark:text-emerald-400">{trReport?.completedToday ?? 0}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Jobs</p>
            <p className="mt-1 text-xl font-semibold">{trReport?.byStatus?.reduce((s, d) => s + d.value, 0) ?? 0}</p>
          </Card>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Daily Trips</CardTitle></CardHeader>
            <CardContent><GroupedBarChartCard data={trReport?.dailyTrips ?? []} keys={['deliveries', 'collections']} colors={['#0ea5e9', '#10b981']} height={240} /></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Jobs by Status</CardTitle></CardHeader>
            <CardContent><DonutChartCard data={trReport?.byStatus ?? []} height={240} /></CardContent>
          </Card>
        </div>
      </div>

      {/* Breakdown Report Section */}
      <div className="pt-2">
        <h2 className="mb-3 text-lg font-semibold text-foreground">Breakdown Analysis</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 mb-4">
          <Card className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Open Cases</p>
            <p className="mt-1 text-xl font-semibold text-rose-600 dark:text-rose-400">{bdReport?.openCases ?? 0}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Avg Downtime</p>
            <p className="mt-1 text-xl font-semibold">{bdReport?.avgDowntime ?? 0}h</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Cases</p>
            <p className="mt-1 text-xl font-semibold">{bdReport?.bySeverity?.reduce((s, d) => s + d.value, 0) ?? 0}</p>
          </Card>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Breakdowns by Severity</CardTitle></CardHeader>
            <CardContent><DonutChartCard data={bdReport?.bySeverity ?? []} height={240} /></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Monthly Breakdown Trend</CardTitle></CardHeader>
            <CardContent><BarChartCard data={bdReport?.monthly ?? []} color="#ef4444" height={240} /></CardContent>
          </Card>
        </div>
      </div>

      {/* Cross Hire Report Section */}
      <div className="pt-2">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-foreground">
          <ArrowRightLeft className="h-5 w-5 text-muted-foreground" /> Cross Hire Performance
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 mb-4">
          <Card className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Active Deals</p>
            <p className="mt-1 text-xl font-semibold">{chStats?.activeDeals ?? 0}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Units Out</p>
            <p className="mt-1 text-xl font-semibold">{chStats?.totalUnits ?? 0}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Revenue / mo</p>
            <p className="mt-1 text-xl font-semibold">{chStats ? formatCurrency(chStats.monthlyRevenue) : '—'}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Margin / mo</p>
            <p className="mt-1 text-xl font-semibold text-emerald-600 dark:text-emerald-400">{chStats ? formatCurrency(chStats.monthlyMargin) : '—'}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Markup</p>
            <p className="mt-1 text-xl font-semibold">{chStats?.marginPct ?? 0}%</p>
          </Card>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2"><CardTitle className="text-base">Cross Hire by Branch / Department</CardTitle></CardHeader>
            <CardContent>
              {chStats?.byBranch?.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                        <th className="py-2 text-left font-medium">Branch</th>
                        <th className="py-2 text-right font-medium">Deals</th>
                        <th className="py-2 text-right font-medium">Units</th>
                        <th className="py-2 text-right font-medium">Revenue/mo</th>
                        <th className="py-2 text-right font-medium">Margin/mo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chStats.byBranch.map((b) => (
                        <tr key={b.branch} className="border-b border-border/50 last:border-0">
                          <td className="py-2 font-medium text-foreground">{b.branch}</td>
                          <td className="py-2 text-right tabular-nums">{b.deals}</td>
                          <td className="py-2 text-right tabular-nums">{b.units}</td>
                          <td className="py-2 text-right tabular-nums">{formatCurrency(b.revenue)}</td>
                          <td className={cn('py-2 text-right font-semibold tabular-nums', b.margin >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                            {formatCurrency(b.margin)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">No cross hire deals.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Cross Hire by Status</CardTitle></CardHeader>
            <CardContent><DonutChartCard data={chStats?.byStatus ?? []} height={240} /></CardContent>
          </Card>
        </div>
      </div>

      {/* Branch Performance Table */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Branch Performance</CardTitle></CardHeader>
        <CardContent>
          <DataTable columns={branchColumns} data={branchPerf ?? []} pageSize={10} rowKey={(r) => r.branch} />
        </CardContent>
      </Card>
    </div>
  );
}
