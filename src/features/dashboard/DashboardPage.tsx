import { PageHeader } from '@/components/common/PageHeader';
import { KPICard } from '@/components/common/KPICard';
import { SixSigmaCard } from '@/components/common/SixSigmaCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChartCard, DonutChartCard, GroupedBarChartCard, AreaChartCard } from '@/components/charts/Charts';
import { Timeline } from '@/components/common/Timeline';
import { LoadingState, ErrorState, EmptyState } from '@/components/common/EmptyState';
import {
  useKPIs, useFleetByCategory, useFleetByStatus, useBranchUtilization,
  useWorkshopPerformance, useRecentActivity, useSixSigmaMetrics, useCrossHireStats,
} from '@/hooks/useQueries';
import { formatCurrency } from '@/utils/format';
import { useAuthStore, roleDashboard, type DashboardWidget } from '@/store/authStore';
import { 
  calculateFleetUtilization, 
  calculateFleetAvailability, 
  calculateMaintenanceQuality,
  calculateMTBF, 
  calculateMTTR, 
  paretoAnalysis,
  calculateWaitingTimeAnalysis,
  calculateReworkAnalysis,
  calculate5SScore,
} from '@/utils/sixSigma';
import {
  Forklift, CheckCircle2, Wrench, Truck, ShieldCheck, ClipboardCheck,
  AlertTriangle, PackageCheck, Activity, ArrowRight, Percent, Sparkles,
  LogIn, LogOut, CalendarDays, FileText, ScanLine, LayoutDashboard, TrendingUp,
  ArrowRightLeft, Wallet,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

export function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const hasPageAccess = useAuthStore((s) => s.hasPageAccess);

  const { data: kpis, isLoading: kpiLoading, isError: kpiError, refetch: refetchKpis } = useKPIs();
  const { data: byCategory } = useFleetByCategory();
  const { data: byStatus } = useFleetByStatus();
  const { data: branchUtil } = useBranchUtilization();
  const { data: wsPerf } = useWorkshopPerformance();
  const { data: activity } = useRecentActivity();
  const { data: sixSigmaData } = useSixSigmaMetrics();
  const { data: crossHireStats } = useCrossHireStats();
  const showCrossHire = hasPageAccess('/cross-hire');

  // Calculate Six Sigma metrics for Fleet Management
  const fleetUtilization = sixSigmaData
    ? calculateFleetUtilization(sixSigmaData.machines)
    : null;

  const fleetAvailability = sixSigmaData
    ? calculateFleetAvailability(sixSigmaData.machines)
    : null;

  const maintenanceQuality = sixSigmaData
    ? calculateMaintenanceQuality(sixSigmaData.inspections)
    : null;

  const mtbf = sixSigmaData
    ? calculateMTBF({
        machines: sixSigmaData.machines,
        breakdowns: sixSigmaData.breakdowns,
      })
    : null;

  const mttr = sixSigmaData
    ? calculateMTTR({
        workshopJobs: sixSigmaData.workshopJobs,
        breakdowns: sixSigmaData.breakdowns,
      })
    : null;

  const paretoData = sixSigmaData
    ? paretoAnalysis(sixSigmaData.breakdowns)
    : [];

  // 7 Wastes Analysis
  const waitingAnalysis = sixSigmaData
    ? calculateWaitingTimeAnalysis({
        workshopJobs: sixSigmaData.workshopJobs,
        breakdowns: sixSigmaData.breakdowns,
      })
    : null;

  const reworkAnalysis = sixSigmaData
    ? calculateReworkAnalysis({
        inspections: sixSigmaData.inspections,
        workshopJobs: sixSigmaData.workshopJobs,
      })
    : null;

  // 5S Workplace Organization
  const fiveSScore = sixSigmaData
    ? calculate5SScore({
        machines: sixSigmaData.machines,
        workshopJobs: sixSigmaData.workshopJobs,
        inspections: sixSigmaData.inspections,
      })
    : null;

  // Which widgets this role is allowed to see
  const widgets: DashboardWidget[] = user ? roleDashboard[user.role] ?? [] : [];
  const can = (w: DashboardWidget) => widgets.includes(w);

  // Quick actions, filtered to pages the role can actually open
  const allQuickActions = [
    { 
      label: 'New Booking', 
      description: 'Schedule equipment delivery to customer site',
      icon: CalendarDays, 
      path: '/planner', 
      gradient: 'from-sky-500 to-blue-500' 
    },
    { 
      label: 'Report Breakdown', 
      description: 'Log equipment failure or maintenance issue',
      icon: AlertTriangle, 
      path: '/breakdowns', 
      gradient: 'from-rose-500 to-red-500' 
    },
    { 
      label: 'Gate Pass', 
      description: 'Create entry/exit pass for equipment movement',
      icon: ScanLine, 
      path: '/gate', 
      gradient: 'from-emerald-500 to-teal-500' 
    },
    { 
      label: 'New Job Card', 
      description: 'Initiate workshop repair or service job',
      icon: FileText, 
      path: '/job-cards', 
      gradient: 'from-amber-500 to-orange-500' 
    },
  ];
  const quickActions = allQuickActions.filter((a) => hasPageAccess(a.path));

  if (kpiError) {
    return <ErrorState onRetry={() => refetchKpis()} />;
  }

  // Build the KPI card list from the allowed widgets
  const kpiCards = [
    { w: 'kpi.available' as const,  el: <KPICard key="av"  label="Available"   value={kpis?.available ?? 0}  icon={CheckCircle2}   color="green"  trend={4}  trendLabel="vs last week" /> },
    { w: 'kpi.onHire' as const,     el: <KPICard key="oh"  label="On Hire"     value={kpis?.onHire ?? 0}     icon={Truck}          color="blue"   trend={8}  trendLabel="active rentals" /> },
    { w: 'kpi.workshop' as const,   el: <KPICard key="ws"  label="Workshop"    value={kpis?.inWorkshop ?? 0} icon={PackageCheck}   color="purple" /> },
    { w: 'kpi.breakdowns' as const, el: <KPICard key="bd"  label="Breakdowns"  value={kpis?.breakdowns ?? 0} icon={AlertTriangle}  color="red"    trend={-1} trendLabel="open cases" /> },
    { w: 'kpi.transport' as const,  el: <KPICard key="tr"  label="Transport"   value={kpis?.transport ?? 0}  icon={Truck}          color="indigo" /> },
    { w: 'kpi.pdi' as const,        el: <KPICard key="pdi" label="PDI"         value={kpis?.pdi ?? 0}        icon={ShieldCheck}    color="teal" /> },
    { w: 'kpi.phi' as const,        el: <KPICard key="phi" label="PHI"         value={kpis?.phi ?? 0}        icon={ClipboardCheck} color="orange" /> },
    { w: 'kpi.total' as const,      el: <KPICard key="tot" label="Total Fleet" value={kpis?.total ?? 0}      icon={Forklift}       color="slate" /> },
  ].filter((c) => can(c.w));

  const showTodayOps = can('section.todayOps');
  const showQuickActions = can('section.quickActions') && quickActions.length > 0;
  const showSixSigma = true;
  const showChartsRow1 = can('chart.fleetStatus') || can('chart.fleetCategory');
  const showChartsRow2 = can('chart.branchUtil') || can('chart.workshopPerf') || can('chart.utilTrend');
  const showActivity = can('section.recentActivity');

  const hasAnyWidget =
    kpiCards.length > 0 || showTodayOps || showQuickActions || showSixSigma ||
    showChartsRow1 || showChartsRow2 || showActivity;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <div className="space-y-8 p-6">
        {/* Modern Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 p-3">
                <LayoutDashboard className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h1 className="text-3xl font-bold tracking-tight text-foreground">
                  Operations Dashboard
                </h1>
                <p className="text-sm text-muted-foreground">
                  {user ? `${user.role} · ${user.branchName}` : 'Fleet operations'}
                </p>
              </div>
            </div>
          </div>
          {hasPageAccess('/reports') && (
            <Link
              to="/reports"
              className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary to-primary/80 px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:shadow-xl hover:shadow-primary/30"
            >
              <Activity className="h-4 w-4 transition-transform group-hover:scale-110" />
              View Reports
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
          )}
        </div>

        {!hasAnyWidget && (
          <EmptyState
            icon={LayoutDashboard}
            title="No dashboard widgets for your role"
            description="Use the sidebar to go to your work area."
          />
        )}

        {/* Fleet KPIs - Modern Grid */}
        {kpiCards.length > 0 && (
          kpiLoading ? (
            <LoadingState />
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {kpiCards.map((c) => c.el)}
            </div>
          )
        )}

        {/* Cross Hire snapshot — rent IN / re-hire OUT margin */}
        {showCrossHire && crossHireStats && (
          <div>
            <div className="mb-4 flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold tracking-tight text-foreground">Cross Hire</h2>
              <div className="h-px flex-1 bg-border" />
              <Link to="/cross-hire" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                View all <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <KPICard label="Active Deals" value={crossHireStats.activeDeals} icon={ArrowRightLeft} color="blue" />
              <KPICard label="Units Out" value={crossHireStats.totalUnits} icon={Truck} color="indigo" />
              <KPICard label="Revenue / mo" value={formatCurrency(crossHireStats.monthlyRevenue)} icon={Wallet} color="teal" />
              <KPICard label="Margin / mo" value={formatCurrency(crossHireStats.monthlyMargin)} icon={TrendingUp} color="green" trendLabel={`${crossHireStats.marginPct}% markup`} />
            </div>
          </div>
        )}

        {/* Today's Operations - Modern Cards */}
        {showTodayOps && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Card className="group relative overflow-hidden border-0 shadow-lg transition-all hover:shadow-xl">
              <div className="absolute inset-0 bg-gradient-to-br from-sky-500/10 to-transparent" />
              <CardContent className="relative p-6">
                <div className="mb-3 flex items-center gap-2">
                  <div className="rounded-lg bg-sky-500/10 p-2">
                    <LogOut className="h-4 w-4 text-sky-600" />
                  </div>
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Deliveries
                  </span>
                </div>
                <p className="text-3xl font-bold text-foreground">{kpis?.todayDeliveries ?? 0}</p>
                <p className="mt-1 text-xs text-muted-foreground">Today's deliveries</p>
              </CardContent>
            </Card>

            <Card className="group relative overflow-hidden border-0 shadow-lg transition-all hover:shadow-xl">
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-transparent" />
              <CardContent className="relative p-6">
                <div className="mb-3 flex items-center gap-2">
                  <div className="rounded-lg bg-emerald-500/10 p-2">
                    <LogIn className="h-4 w-4 text-emerald-600" />
                  </div>
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Collections
                  </span>
                </div>
                <p className="text-3xl font-bold text-foreground">{kpis?.todayCollections ?? 0}</p>
                <p className="mt-1 text-xs text-muted-foreground">Today's collections</p>
              </CardContent>
            </Card>

            <Card className="group relative overflow-hidden border-0 shadow-lg transition-all hover:shadow-xl">
              <div className="absolute inset-0 bg-gradient-to-br from-violet-500/10 to-transparent" />
              <CardContent className="relative p-6">
                <div className="mb-3 flex items-center gap-2">
                  <div className="rounded-lg bg-violet-500/10 p-2">
                    <Percent className="h-4 w-4 text-violet-600" />
                  </div>
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Fleet Util
                  </span>
                </div>
                <p className="text-3xl font-bold text-foreground">{kpis?.fleetUtilization ?? 0}%</p>
                <p className="mt-1 text-xs text-muted-foreground">Current utilization</p>
              </CardContent>
            </Card>

            <Card className="group relative overflow-hidden border-0 shadow-lg transition-all hover:shadow-xl">
              <div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 to-transparent" />
              <CardContent className="relative p-6">
                <div className="mb-3 flex items-center gap-2">
                  <div className="rounded-lg bg-amber-500/10 p-2">
                    <Wrench className="h-4 w-4 text-amber-600" />
                  </div>
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Workshop
                  </span>
                </div>
                <p className="text-3xl font-bold text-foreground">{kpis?.workshopUtilization ?? 0}%</p>
                <p className="mt-1 text-xs text-muted-foreground">Workshop utilization</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Quick Actions - Compact, Descriptive */}
        {showQuickActions && (
          <div>
            <div className="mb-4 flex items-center gap-2">
              <h2 className="text-lg font-semibold tracking-tight text-foreground">Quick Actions</h2>
              <div className="h-px flex-1 bg-border" />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {quickActions.map((action) => (
                <Link
                  key={action.label}
                  to={action.path}
                  className="group relative overflow-hidden rounded-xl border bg-card p-4 shadow-sm transition-all hover:border-primary/50 hover:shadow-md"
                >
                  <div className="flex items-start gap-3">
                    <div className={cn('shrink-0 rounded-lg bg-gradient-to-br p-2.5 shadow-sm', action.gradient)}>
                      <action.icon className="h-5 w-5 text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-sm text-foreground truncate">{action.label}</h3>
                      <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">{action.description}</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Six Sigma Metrics - Apple Design */}
        {showSixSigma && fleetUtilization && fleetAvailability && maintenanceQuality && mtbf !== null && mttr !== null && (
          <div className="space-y-6">
            {/* Section Header */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <h2 className="text-xl font-bold tracking-tight text-foreground">
                  Lean Six Sigma Metrics
                </h2>
              </div>
              <div className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
            </div>

            {/* Metrics Cards - Row 1: Fleet Performance */}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              <SixSigmaCard
                label="Fleet Utilization Rate"
                value={fleetUtilization.utilizationRate}
                target={75}
                unit="%"
                status={
                  fleetUtilization.utilizationRate >= 75 ? 'good' : 
                  fleetUtilization.utilizationRate >= 60 ? 'warning' : 'bad'
                }
                description={`${fleetUtilization.onHireCount} on hire · ${fleetUtilization.availableCount} available for rent`}
              />

              <SixSigmaCard
                label="Fleet Availability Rate"
                value={fleetAvailability.availabilityRate}
                target={90}
                unit="%"
                status={
                  fleetAvailability.availabilityRate >= 90 ? 'good' : 
                  fleetAvailability.availabilityRate >= 80 ? 'warning' : 'bad'
                }
                description={`${fleetAvailability.readyMachines} ready · ${fleetAvailability.downMachines} down/workshop`}
              />

              <SixSigmaCard
                label="Maintenance Quality Score"
                value={maintenanceQuality.qualityScore}
                target={90}
                unit="%"
                status={
                  maintenanceQuality.qualityScore >= 90 ? 'good' : 
                  maintenanceQuality.qualityScore >= 75 ? 'warning' : 'bad'
                }
                description={`${maintenanceQuality.passedCount} passed · ${maintenanceQuality.totalCount - maintenanceQuality.passedCount} failed inspections`}
              />
            </div>

            {/* Metrics Cards - Row 2: Reliability */}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <SixSigmaCard
                label="Mean Time Between Failures"
                value={mtbf}
                target={300}
                unit="h"
                status={mtbf >= 300 ? 'good' : mtbf >= 200 ? 'warning' : 'bad'}
                description="Average operating hours between breakdowns"
              />

              <SixSigmaCard
                label="Mean Time To Repair"
                value={mttr}
                target={4}
                unit="h"
                targetLabel="Target"
                status={mttr <= 4 ? 'good' : mttr <= 6 ? 'warning' : 'bad'}
                description="Average time to complete repairs"
              />
            </div>

            {/* 7 Wastes Analysis Section */}
            {waitingAnalysis && reworkAnalysis && (
              <>
                {/* Section Divider */}
                <div className="flex items-center gap-4 pt-4">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold tracking-tight text-foreground">
                      7 Wastes Analysis
                    </h3>
                  </div>
                  <div className="h-px flex-1 bg-gradient-to-r from-border/50 to-transparent" />
                </div>

                {/* Waiting Time Analysis Card */}
                <Card className="border-0 shadow-xl">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2 text-lg">
                          <Activity className="h-5 w-5 text-amber-600" />
                          Waiting Time Breakdown
                        </CardTitle>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Where machines are stuck in the repair cycle
                        </p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
                      <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-bold text-foreground">
                          {waitingAnalysis.totalNonValueAddTime}
                        </span>
                        <span className="text-lg text-muted-foreground">days</span>
                        <span className="ml-auto text-sm font-medium text-amber-700 dark:text-amber-300">
                          {waitingAnalysis.percentageNonValueAdd}% non-value-add time
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Average repair cycle: {waitingAnalysis.avgRepairCycle} days
                      </p>
                    </div>

                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium text-foreground">Waiting for Parts</span>
                          <span className="font-bold text-rose-600">{waitingAnalysis.avgWaitingForParts} days (65%)</span>
                        </div>
                        <div className="relative h-2 overflow-hidden rounded-full bg-muted/30">
                          <div 
                            className="h-full rounded-full bg-gradient-to-r from-rose-500 to-red-500"
                            style={{ width: '65%' }}
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium text-foreground">Waiting for Mechanic</span>
                          <span className="font-bold text-amber-600">{waitingAnalysis.avgWaitingForMechanic} days (28%)</span>
                        </div>
                        <div className="relative h-2 overflow-hidden rounded-full bg-muted/30">
                          <div 
                            className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500"
                            style={{ width: '28%' }}
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium text-foreground">Waiting for Approval</span>
                          <span className="font-bold text-emerald-600">{waitingAnalysis.avgWaitingForApproval} days (7%)</span>
                        </div>
                        <div className="relative h-2 overflow-hidden rounded-full bg-muted/30">
                          <div 
                            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500"
                            style={{ width: '7%' }}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 rounded-xl border border-rose-500/30 bg-gradient-to-r from-rose-500/10 to-red-500/5 p-4">
                      <p className="flex items-start gap-2 text-sm font-medium text-rose-700 dark:text-rose-300">
                        <span className="text-lg">🎯</span>
                        <span>
                          <strong>Priority Action:</strong> Expedite parts procurement process.
                          Reducing parts delay from {waitingAnalysis.avgWaitingForParts}d → 2.0d would save{' '}
                          <strong>{Math.round((waitingAnalysis.avgWaitingForParts - 2) * 10) / 10} days per repair</strong>
                        </span>
                      </p>
                    </div>
                  </CardContent>
                </Card>

                {/* Defects & Rework Analysis Card */}
                <Card className="border-0 shadow-xl">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2 text-lg">
                          <Wrench className="h-5 w-5 text-rose-600" />
                          Quality & Rework Analysis
                        </CardTitle>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Inspection failures and rework cycles
                        </p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-4">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">First-Time PDI Pass</p>
                        <p className="mt-1 text-2xl font-bold text-rose-600">{reworkAnalysis.firstTimePDIPass}%</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">Target: 90%</p>
                      </div>
                      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Rework Cycles</p>
                        <p className="mt-1 text-2xl font-bold text-amber-600">{reworkAnalysis.avgReworkCycles}x</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">Per machine avg</p>
                      </div>
                    </div>

                    <div>
                      <h4 className="mb-3 text-sm font-semibold text-foreground">Top Failure Reasons</h4>
                      <div className="space-y-2">
                        {reworkAnalysis.topFailureReasons.map((reason, idx) => (
                          <div key={reason.reason} className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className={cn(
                                "flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold",
                                idx === 0 ? "bg-rose-500 text-white" :
                                idx === 1 ? "bg-amber-500 text-white" :
                                "bg-slate-400 text-white"
                              )}>
                                {idx + 1}
                              </span>
                              <span className="text-sm font-medium text-foreground">{reason.reason}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-foreground">{reason.percentage}%</span>
                              <span className="text-xs text-muted-foreground">({reason.count})</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-xl border border-rose-500/30 bg-gradient-to-r from-rose-500/10 to-red-500/5 p-4">
                      <p className="flex items-start gap-2 text-sm font-medium text-rose-700 dark:text-rose-300">
                        <span className="text-lg">🔧</span>
                        <span>
                          <strong>Action Required:</strong> Focus technician training on{' '}
                          <strong>{reworkAnalysis.topFailureReasons[0]?.reason || 'top failure reasons'}</strong>.
                          Improving pass rate from {reworkAnalysis.firstTimePDIPass}% → 75% would reduce rework by{' '}
                          <strong>31%</strong> and save ~AED {Math.round(reworkAnalysis.totalReworkCost * 0.31 / 1000)}K/month
                        </span>
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}

            {/* 5S Workplace Organization */}
            {fiveSScore && (
              <>
                <div className="flex items-center gap-4 pt-4">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold tracking-tight text-foreground">
                      5S Workplace Organization
                    </h3>
                  </div>
                  <div className="h-px flex-1 bg-gradient-to-r from-border/50 to-transparent" />
                </div>

                <Card className="border-0 shadow-xl">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2 text-lg">
                          <Sparkles className="h-5 w-5 text-primary" />
                          Workshop Discipline Score
                        </CardTitle>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Operational excellence across 5 dimensions
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-3xl font-bold text-foreground">{fiveSScore.overall}%</p>
                        <p className="text-xs text-muted-foreground">Target: 90%</p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {[
                      { label: 'Sustain', score: fiveSScore.sustain, desc: 'QR scan GPS compliance' },
                      { label: 'Set in Order', score: fiveSScore.setInOrder, desc: 'Proper job assignments' },
                      { label: 'Sort', score: fiveSScore.sort, desc: 'Bay utilization efficiency' },
                      { label: 'Standardize', score: fiveSScore.standardize, desc: 'Inspection completeness' },
                      { label: 'Shine', score: fiveSScore.shine, desc: 'Washing bay usage' },
                    ].map((item) => (
                      <div key={item.label} className="space-y-1.5">
                        <div className="flex items-center justify-between text-sm">
                          <div>
                            <span className="font-semibold text-foreground">{item.label}</span>
                            <span className="ml-2 text-xs text-muted-foreground">{item.desc}</span>
                          </div>
                          <span className={cn(
                            "font-bold",
                            item.score >= 90 ? "text-emerald-600" :
                            item.score >= 80 ? "text-amber-600" :
                            "text-rose-600"
                          )}>
                            {item.score}%
                          </span>
                        </div>
                        <div className="relative h-2 overflow-hidden rounded-full bg-muted/30">
                          <div 
                            className={cn(
                              "h-full rounded-full transition-all duration-700",
                              item.score >= 90 ? "bg-gradient-to-r from-emerald-500 to-teal-500" :
                              item.score >= 80 ? "bg-gradient-to-r from-amber-500 to-orange-500" :
                              "bg-gradient-to-r from-rose-500 to-red-500"
                            )}
                            style={{ width: `${item.score}%` }}
                          />
                        </div>
                      </div>
                    ))}

                    {fiveSScore.overall < 90 && (
                      <div className="mt-4 rounded-xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 to-orange-500/5 p-4">
                        <p className="flex items-start gap-2 text-sm font-medium text-amber-700 dark:text-amber-300">
                          <span className="text-lg">💡</span>
                          <span>
                            Focus on improving <strong>Shine</strong> (washing bay usage) to reach 90% target.
                            Better documentation prevents damage disputes and improves customer satisfaction.
                          </span>
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            )}

            {/* Pareto Analysis */}
            {paretoData.length > 0 && (
              <Card className="border-0 shadow-xl">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-lg">
                        <TrendingUp className="h-5 w-5 text-primary" />
                        Top Breakdown Causes
                      </CardTitle>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Pareto analysis: Focus on vital few to eliminate 80% of issues
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {paretoData.slice(0, 5).map((item, idx) => (
                    <div key={item.cause} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-foreground">{item.cause}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-foreground">{item.percentage}%</span>
                          <span className="text-xs text-muted-foreground">({item.count} cases)</span>
                        </div>
                      </div>
                      <div className="relative h-3 overflow-hidden rounded-full bg-muted/30">
                        <div
                          className={cn(
                            'h-full rounded-full transition-all duration-700',
                            idx === 0 ? 'bg-gradient-to-r from-rose-500 via-rose-400 to-red-400' :
                            idx === 1 ? 'bg-gradient-to-r from-amber-500 via-amber-400 to-orange-400' :
                            'bg-gradient-to-r from-slate-400 to-slate-300'
                          )}
                          style={{ width: `${item.percentage}%` }}
                        />
                      </div>
                    </div>
                  ))}
                  {paretoData.length > 0 && (
                    <div className="mt-6 rounded-xl border border-emerald-500/30 bg-gradient-to-r from-emerald-500/10 to-teal-500/5 p-4">
                      <p className="flex items-start gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
                        <span className="text-lg">💡</span>
                        <span>
                          Fixing the top {Math.min(2, paretoData.length)} causes would eliminate approximately{' '}
                          <strong>{paretoData.slice(0, 2).reduce((sum, item) => sum + item.percentage, 0)}%</strong> of all breakdowns
                        </span>
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Charts - Modern Layout */}
        {showChartsRow1 && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {can('chart.fleetStatus') && (
              <Card className={cn('border-0 shadow-xl', can('chart.fleetCategory') ? 'lg:col-span-2' : 'lg:col-span-3')}>
                <CardHeader>
                  <CardTitle className="text-base">Fleet Status Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  <BarChartCard data={byStatus ?? []} height={260} />
                </CardContent>
              </Card>
            )}
            {can('chart.fleetCategory') && (
              <Card className={cn('border-0 shadow-xl', !can('chart.fleetStatus') && 'lg:col-span-3')}>
                <CardHeader>
                  <CardTitle className="text-base">Fleet by Category</CardTitle>
                </CardHeader>
                <CardContent>
                  <DonutChartCard data={byCategory ?? []} height={260} />
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {showChartsRow2 && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {can('chart.branchUtil') && (
              <Card className="border-0 shadow-xl">
                <CardHeader>
                  <CardTitle className="text-base">Branch Utilization</CardTitle>
                </CardHeader>
                <CardContent>
                  <BarChartCard
                    data={branchUtil?.map((b) => ({ label: b.label, value: b.utilization })) ?? []}
                    color="#10b981"
                    height={240}
                  />
                </CardContent>
              </Card>
            )}
            {can('chart.workshopPerf') && (
              <Card className="border-0 shadow-xl">
                <CardHeader>
                  <CardTitle className="text-base">Workshop Performance</CardTitle>
                </CardHeader>
                <CardContent>
                  <GroupedBarChartCard
                    data={wsPerf ?? []}
                    keys={['completed', 'intake']}
                    colors={['#0ea5e9', '#f59e0b']}
                    height={240}
                  />
                </CardContent>
              </Card>
            )}
            {can('chart.utilTrend') && (
              <Card className="border-0 shadow-xl">
                <CardHeader>
                  <CardTitle className="text-base">Utilization Trend</CardTitle>
                </CardHeader>
                <CardContent>
                  <AreaChartCard
                    data={[
                      { label: 'Mon', value: 62 },
                      { label: 'Tue', value: 68 },
                      { label: 'Wed', value: 71 },
                      { label: 'Thu', value: 65 },
                      { label: 'Fri', value: 74 },
                      { label: 'Sat', value: 58 },
                      { label: 'Sun', value: 52 },
                    ]}
                    color="#8b5cf6"
                    height={240}
                  />
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Recent Activity */}
        {showActivity && (
          <Card className="border-0 shadow-xl">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Recent Activity</CardTitle>
                {hasPageAccess('/notifications') && (
                  <Link
                    to="/notifications"
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:text-primary/80"
                  >
                    View all
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <Timeline
                events={(activity ?? []).map((a) => ({
                  id: a.id,
                  timestamp: a.timestamp,
                  title: a.title,
                  description: `${a.machineAsset} · ${a.machineModel}`,
                  actor: a.actor,
                  type: a.type,
                }))}
                compact
              />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
