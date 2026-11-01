import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useTransportJobs } from '@/hooks/useQueries';
import { useBranchFilter } from '@/hooks/useBranchFilter';
import { cn } from '@/lib/utils';
import { Download, TrendingDown, TrendingUp } from 'lucide-react';
import { format } from 'date-fns';

const VAT_RATE = 0.05;

interface TripRow {
  date: string;
  reference: string;
  truck: string;
  route: string;
  customer: string;
  amount: number;       // ex-VAT charge
  vat: number;          // 5% VAT
  cost: number;         // internal cost
  revenue: number;      // amount + vat
  revenueVat: number;   // vat portion
  profitLoss: number;   // revenue - cost
}

export function TripbaseReportPage() {
  const { data: allJobs } = useTransportJobs();
  const jobs = useBranchFilter(allJobs);
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const rows = useMemo((): TripRow[] => {
    const [year, month] = selectedMonth.split('-').map(Number);
    
    return jobs
      .filter((j) => {
        const d = new Date(j.scheduledTime);
        return d.getFullYear() === year && d.getMonth() + 1 === month;
      })
      .map((j) => {
        const amount = j.chargeToCustomer;
        const cost = j.internalCost;
        const vat = amount * VAT_RATE;
        const revenue = amount + vat;
        const revenueVat = vat;
        const profitLoss = revenue - cost;

        return {
          date: format(new Date(j.scheduledTime), 'dd MMM'),
          reference: j.reference,
          truck: j.truckRegistration,
          route: `${j.origin.split(' ')[0]} → ${j.destination.split(' ')[0]}`,
          customer: j.customerName || 'Internal',
          amount,
          vat,
          cost,
          revenue,
          revenueVat,
          profitLoss,
        };
      })
      .sort((a, b) => a.reference.localeCompare(b.reference));
  }, [jobs, selectedMonth]);

  const totals = useMemo(() => {
    const totalAmount = rows.reduce((sum, r) => sum + r.amount, 0);
    const totalVat = rows.reduce((sum, r) => sum + r.vat, 0);
    const totalCost = rows.reduce((sum, r) => sum + r.cost, 0);
    const totalRevenue = rows.reduce((sum, r) => sum + r.revenue, 0);
    const totalRevenueVat = rows.reduce((sum, r) => sum + r.revenueVat, 0);
    const totalProfitLoss = rows.reduce((sum, r) => sum + r.profitLoss, 0);

    return {
      amount: totalAmount,
      vat: totalVat,
      cost: totalCost,
      revenue: totalRevenue,
      revenueVat: totalRevenueVat,
      profitLoss: totalProfitLoss,
    };
  }, [rows]);

  const profitableCount = rows.filter((r) => r.profitLoss > 0).length;
  const lossCount = rows.filter((r) => r.profitLoss < 0).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="TRIPBASE Report"
        description="Monthly transport cost vs revenue — profit/loss per job"
        actions={
          <Button variant="outline" size="sm">
            <Download className="mr-1.5 h-4 w-4" /> Export to Excel
          </Button>
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Total Jobs</p>
          <p className="mt-1 text-2xl font-bold text-foreground">{rows.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Total Revenue</p>
          <p className="mt-1 text-2xl font-bold text-foreground">
            AED {totals.revenue.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Total Cost</p>
          <p className="mt-1 text-2xl font-bold text-foreground">
            AED {totals.cost.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </Card>
        <Card className={cn('p-4', totals.profitLoss >= 0 ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50')}>
          <p className="text-xs text-muted-foreground">Net P/L</p>
          <div className="mt-1 flex items-center gap-2">
            {totals.profitLoss >= 0 ? (
              <TrendingUp className="h-5 w-5 text-emerald-600" />
            ) : (
              <TrendingDown className="h-5 w-5 text-red-600" />
            )}
            <p className={cn('text-2xl font-bold', totals.profitLoss >= 0 ? 'text-emerald-700' : 'text-red-700')}>
              AED {Math.abs(totals.profitLoss).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {profitableCount} profitable · {lossCount} loss
          </p>
        </Card>
      </div>

      {/* Month filter */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-foreground">Month</label>
        <input
          type="month"
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
        />
      </div>

      {/* Table */}
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-foreground">Date</th>
                <th className="px-4 py-3 text-left font-semibold text-foreground">Reference</th>
                <th className="px-4 py-3 text-left font-semibold text-foreground">Truck</th>
                <th className="px-4 py-3 text-left font-semibold text-foreground">Route</th>
                <th className="px-4 py-3 text-left font-semibold text-foreground">Customer</th>
                <th className="px-4 py-3 text-right font-semibold text-foreground">Amount (ex-VAT)</th>
                <th className="px-4 py-3 text-right font-semibold text-foreground">VAT 5%</th>
                <th className="px-4 py-3 text-right font-semibold text-foreground">Cost (AED)</th>
                <th className="px-4 py-3 text-right font-semibold text-foreground">Revenue (AED)</th>
                <th className="px-4 py-3 text-right font-semibold text-foreground">Revenue VAT</th>
                <th className="px-4 py-3 text-right font-semibold text-foreground">P/L (AED)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row, i) => (
                <tr key={i} className="hover:bg-muted/20">
                  <td className="px-4 py-2.5 text-muted-foreground">{row.date}</td>
                  <td className="px-4 py-2.5 font-medium text-foreground">{row.reference}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{row.truck}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{row.route}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{row.customer}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-foreground">
                    {row.amount.toLocaleString('en-AE', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-2.5 text-right text-muted-foreground">
                    {row.vat.toLocaleString('en-AE', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium text-foreground">
                    {row.cost.toLocaleString('en-AE', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium text-foreground">
                    {row.revenue.toLocaleString('en-AE', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-2.5 text-right text-muted-foreground">
                    {row.revenueVat.toLocaleString('en-AE', { minimumFractionDigits: 2 })}
                  </td>
                  <td className={cn('px-4 py-2.5 text-right font-semibold',
                    row.profitLoss >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                    {row.profitLoss.toLocaleString('en-AE', { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
              {/* Totals row */}
              <tr className="border-t-2 border-border bg-muted/60 font-bold">
                <td colSpan={5} className="px-4 py-3 text-left text-foreground">Total</td>
                <td className="px-4 py-3 text-right text-foreground">
                  {totals.amount.toLocaleString('en-AE', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-4 py-3 text-right text-foreground">
                  {totals.vat.toLocaleString('en-AE', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-4 py-3 text-right text-foreground">
                  {totals.cost.toLocaleString('en-AE', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-4 py-3 text-right text-foreground">
                  {totals.revenue.toLocaleString('en-AE', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-4 py-3 text-right text-foreground">
                  {totals.revenueVat.toLocaleString('en-AE', { minimumFractionDigits: 2 })}
                </td>
                <td className={cn('px-4 py-3 text-right',
                  totals.profitLoss >= 0 ? 'text-emerald-700' : 'text-red-700')}>
                  {totals.profitLoss.toLocaleString('en-AE', { minimumFractionDigits: 2 })}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {rows.length === 0 && (
        <Card className="flex items-center justify-center p-8 text-center text-muted-foreground">
          No transport jobs found for the selected month
        </Card>
      )}
    </div>
  );
}
