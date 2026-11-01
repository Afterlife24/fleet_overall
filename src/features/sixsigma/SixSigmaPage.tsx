import { PageHeader } from '@/components/common/PageHeader';
import { SixSigmaCard } from '@/components/common/SixSigmaCard';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { LoadingState, EmptyState } from '@/components/common/EmptyState';
import { useSixSigmaMetrics } from '@/hooks/useQueries';
import {
  calculateFleetUtilization, calculateFleetAvailability, calculateMaintenanceQuality,
  calculateMTBF, calculateMTTR, calculate5SScore,
} from '@/utils/sixSigma';
import { Gauge, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

export function SixSigmaPage() {
  const { data, isLoading } = useSixSigmaMetrics();

  if (isLoading) return <LoadingState />;

  const machines = data?.machines ?? [];
  const inspections = data?.inspections ?? [];

  if (machines.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader title="Six Sigma" description="Lean metrics and operational excellence" />
        <EmptyState
          icon={Gauge}
          title="No fleet data yet"
          description="Add machines to your fleet to see Lean Six Sigma metrics (utilization, MTBF/MTTR, 5S)."
        />
      </div>
    );
  }

  const util = calculateFleetUtilization(machines);
  const avail = calculateFleetAvailability(machines);
  const quality = calculateMaintenanceQuality(inspections);
  const mtbf = calculateMTBF({ machines, breakdowns: data?.breakdowns ?? [] });
  const mttr = calculateMTTR({ workshopJobs: data?.workshopJobs ?? [], breakdowns: data?.breakdowns ?? [] });
  const fiveS = calculate5SScore({ machines, workshopJobs: data?.workshopJobs ?? [], inspections });

  return (
    <div className="space-y-6">
      <PageHeader title="Six Sigma" description="Lean metrics, reliability and 5S workplace discipline" />

      {/* Core metrics */}
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold tracking-tight text-foreground">Fleet Performance</h2>
        <div className="h-px flex-1 bg-border" />
      </div>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <SixSigmaCard
          label="Fleet Utilization Rate" value={util.utilizationRate} target={75} unit="%"
          status={util.utilizationRate >= 75 ? 'good' : util.utilizationRate >= 60 ? 'warning' : 'bad'}
          description={`${util.onHireCount} on hire · ${util.availableCount} available for rent`}
        />
        <SixSigmaCard
          label="Fleet Availability Rate" value={avail.availabilityRate} target={90} unit="%"
          status={avail.availabilityRate >= 90 ? 'good' : avail.availabilityRate >= 80 ? 'warning' : 'bad'}
          description={`${avail.readyMachines} ready · ${avail.downMachines} down/workshop`}
        />
        <SixSigmaCard
          label="Maintenance Quality Score" value={quality.qualityScore} target={90} unit="%"
          status={quality.qualityScore >= 90 ? 'good' : quality.qualityScore >= 75 ? 'warning' : 'bad'}
          description={`${quality.passedCount} passed · ${quality.totalCount - quality.passedCount} failed inspections`}
        />
      </div>

      {/* Reliability */}
      <div className="flex items-center gap-2 pt-2">
        <h3 className="text-lg font-semibold tracking-tight text-foreground">Reliability</h3>
        <div className="h-px flex-1 bg-border" />
      </div>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <SixSigmaCard
          label="Mean Time Between Failures" value={mtbf} target={300} unit="h"
          status={mtbf >= 300 ? 'good' : mtbf >= 200 ? 'warning' : 'bad'}
          description="Average operating hours between breakdowns"
        />
        <SixSigmaCard
          label="Mean Time To Repair" value={mttr} target={4} unit="h"
          status={mttr <= 4 ? 'good' : mttr <= 6 ? 'warning' : 'bad'}
          description="Average time to complete repairs"
        />
      </div>

      {/* 5S */}
      <Card className="border-0 shadow-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="h-5 w-5 text-primary" /> 5S Workplace Organization
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            { label: 'Sort', score: fiveS.sort, desc: 'Bay utilization efficiency' },
            { label: 'Set in Order', score: fiveS.setInOrder, desc: 'Proper job assignments' },
            { label: 'Shine', score: fiveS.shine, desc: 'Inspection photo compliance' },
            { label: 'Standardize', score: fiveS.standardize, desc: 'Inspection completeness' },
            { label: 'Sustain', score: fiveS.sustain, desc: 'Process discipline' },
          ].map((item) => (
            <div key={item.label} className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <div>
                  <span className="font-semibold text-foreground">{item.label}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{item.desc}</span>
                </div>
                <span className={cn('font-bold', item.score >= 90 ? 'text-emerald-600' : item.score >= 80 ? 'text-amber-600' : 'text-rose-600')}>
                  {item.score}%
                </span>
              </div>
              <div className="relative h-2 overflow-hidden rounded-full bg-muted/30">
                <div
                  className={cn('h-full rounded-full', item.score >= 90 ? 'bg-emerald-500' : item.score >= 80 ? 'bg-amber-500' : 'bg-rose-500')}
                  style={{ width: `${item.score}%` }}
                />
              </div>
            </div>
          ))}
          <div className="mt-2 flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3">
            <span className="text-sm font-semibold text-foreground">Overall 5S Score</span>
            <span className="text-2xl font-bold text-foreground">{fiveS.overall}%</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
