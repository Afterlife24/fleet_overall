import { PageHeader } from '@/components/common/PageHeader';
import { KPICard } from '@/components/common/KPICard';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { DonutChartCard, BarChartCard } from '@/components/charts/Charts';
import { LoadingState, EmptyState } from '@/components/common/EmptyState';
import { useKPIs, useFleetByCategory, useFleetByStatus, useCrossHireStats } from '@/hooks/useQueries';
import { formatCurrency } from '@/utils/format';
import { BarChart3, Forklift, CheckCircle2, Truck, Wrench, ArrowRightLeft } from 'lucide-react';

export function StatisticsPage() {
  const { data: kpis, isLoading } = useKPIs();
  const { data: byCategory } = useFleetByCategory();
  const { data: byStatus } = useFleetByStatus();
  const { data: ch } = useCrossHireStats();

  if (isLoading) return <LoadingState />;

  if (!kpis || kpis.total === 0) {
    return (
      <div className="space-y-5">
        <PageHeader title="Statistics" description="Fleet and operations analytics" />
        <EmptyState icon={BarChart3} title="No data yet" description="Add fleet and operations data to see statistics." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Statistics" description="Fleet utilization, status mix and cross-hire performance" />

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <KPICard label="Total Fleet" value={kpis.total} icon={Forklift} color="slate" />
        <KPICard label="Available" value={kpis.available} icon={CheckCircle2} color="green" />
        <KPICard label="On Hire" value={kpis.onHire} icon={Truck} color="blue" />
        <KPICard label="In Workshop" value={kpis.inWorkshop} icon={Wrench} color="amber" />
        <KPICard label="Fleet Utilization" value={`${kpis.fleetUtilization}%`} icon={BarChart3} color="purple" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Fleet by Category</CardTitle></CardHeader>
          <CardContent><DonutChartCard data={byCategory ?? []} height={260} /></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Fleet by Status</CardTitle></CardHeader>
          <CardContent><BarChartCard data={byStatus ?? []} height={260} /></CardContent>
        </Card>
      </div>

      {/* Cross hire snapshot */}
      {ch && ch.total > 0 && (
        <div>
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-foreground">
            <ArrowRightLeft className="h-5 w-5 text-muted-foreground" /> Cross Hire
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <KPICard label="Active Deals" value={ch.activeDeals} icon={ArrowRightLeft} color="blue" />
            <KPICard label="Units Out" value={ch.totalUnits} icon={Truck} color="indigo" />
            <KPICard label="Revenue / mo" value={formatCurrency(ch.monthlyRevenue)} icon={BarChart3} color="teal" />
            <KPICard label="Margin / mo" value={formatCurrency(ch.monthlyMargin)} icon={BarChart3} color="green" />
          </div>
        </div>
      )}
    </div>
  );
}
