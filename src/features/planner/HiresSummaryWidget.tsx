import { useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useBookingStore } from '@/store/bookingStore';
import { branches } from '@/services/mock/branches';

// Matches Sheet1 of REF-08 — daily New Hires / Off Hires per branch + UAE total
// new_hires(date, branch) = bookings where startDate = date AND branch = branch
// off_hires(date, branch) = bookings where endDate = date AND branch = branch

function toDateKey(iso: string): string {
  return iso.split('T')[0];
}

interface DaySummary {
  date: string;        // YYYY-MM-DD
  label: string;       // e.g. "Mon 3 Aug"
  newHires: number;
  offHires: number;
  net: number;         // newHires - offHires
}

interface BranchSummary {
  branchId: string;
  branchName: string;
  code: string;
  days: DaySummary[];
  totalNew: number;
  totalOff: number;
  totalNet: number;
}

interface HiresSummaryWidgetProps {
  /** How many days to show — defaults to 14 */
  dayCount?: number;
}

export function HiresSummaryWidget({ dayCount = 14 }: HiresSummaryWidgetProps) {
  const { getAllBookings } = useBookingStore();
  const allBookings = getAllBookings();

  // Build date range starting from today
  const dateRange: string[] = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Array.from({ length: dayCount }, (_, i) => {
      const d = new Date(today);
      d.setDate(today.getDate() + i - Math.floor(dayCount / 2)); // centred around today
      return d.toISOString().split('T')[0];
    });
  }, [dayCount]);

  // Aggregate per branch per day
  const branchSummaries: BranchSummary[] = useMemo(() => {
    return branches.map(branch => {
      const branchBookings = allBookings.filter(b => b.branchId === branch.id);

      const days: DaySummary[] = dateRange.map(date => {
        const newHires = branchBookings.filter(b => toDateKey(b.startDate) === date).length;
        const offHires = branchBookings.filter(b => toDateKey(b.endDate)   === date).length;
        const d = new Date(date);
        const label = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
        return { date, label, newHires, offHires, net: newHires - offHires };
      });

      const totalNew = days.reduce((s, d) => s + d.newHires, 0);
      const totalOff = days.reduce((s, d) => s + d.offHires, 0);

      return {
        branchId:   branch.id,
        branchName: branch.name,
        code:       branch.code,
        days,
        totalNew,
        totalOff,
        totalNet: totalNew - totalOff,
      };
    }).filter(b => b.totalNew > 0 || b.totalOff > 0 || true); // show all branches
  }, [allBookings, dateRange]);

  // UAE total row (all branches combined)
  const uaeTotal: DaySummary[] = useMemo(() => {
    return dateRange.map((date, i) => {
      const newHires = branchSummaries.reduce((s, b) => s + b.days[i].newHires, 0);
      const offHires = branchSummaries.reduce((s, b) => s + b.days[i].offHires, 0);
      const d = new Date(date);
      const label = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
      return { date, label, newHires, offHires, net: newHires - offHires };
    });
  }, [branchSummaries, dateRange]);

  const uaeTotalNew = uaeTotal.reduce((s, d) => s + d.newHires, 0);
  const uaeTotalOff = uaeTotal.reduce((s, d) => s + d.offHires, 0);
  const uaeTotalNet = uaeTotalNew - uaeTotalOff;

  const today = new Date().toISOString().split('T')[0];

  const NetBadge = ({ net }: { net: number }) => (
    <span className={`text-xs font-bold ${net > 0 ? 'text-emerald-600' : net < 0 ? 'text-rose-600' : 'text-muted-foreground'}`}>
      {net > 0 ? `+${net}` : net}
    </span>
  );

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border px-4 py-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Hires Summary</h3>
          <p className="text-xs text-muted-foreground">New Hires / Off Hires per branch per day (REF-08 Sheet1)</p>
        </div>
        <Badge variant="outline" className="text-xs">
          {dayCount} days
        </Badge>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          {/* Header — dates */}
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="sticky left-0 z-10 bg-muted/30 px-3 py-2 text-left font-semibold w-28">Branch</th>
              <th className="sticky left-28 z-10 bg-muted/30 px-2 py-2 text-center font-semibold w-12">Total</th>
              {dateRange.map(date => {
                const d = new Date(date);
                const isToday = date === today;
                return (
                  <th
                    key={date}
                    className={`px-1 py-1.5 text-center font-medium min-w-[64px] ${isToday ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}
                  >
                    <div className="flex flex-col items-center gap-0">
                      <span className="text-[9px] uppercase">{d.toLocaleDateString('en-GB', { weekday: 'short' })}</span>
                      <span className="font-bold text-foreground">{d.getDate()}</span>
                      <span className="text-[9px]">{d.toLocaleDateString('en-GB', { month: 'short' })}</span>
                    </div>
                  </th>
                );
              })}
            </tr>
            {/* Sub-header */}
            <tr className="border-b border-border bg-muted/10">
              <th className="sticky left-0 z-10 bg-muted/10 px-3 py-1 text-left text-muted-foreground font-normal"></th>
              <th className="sticky left-28 z-10 bg-muted/10 px-2 py-1 text-center">
                <span className="text-emerald-600">N</span>/<span className="text-rose-500">O</span>
              </th>
              {dateRange.map(date => (
                <th key={date} className="px-1 py-1 text-center text-muted-foreground font-normal">
                  <span className="text-emerald-600">N</span>/<span className="text-rose-500">O</span>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {/* Per-branch rows */}
            {branchSummaries.map(branch => (
              <tr key={branch.branchId} className="border-b border-border hover:bg-muted/10">
                <td className="sticky left-0 z-10 bg-card px-3 py-2 font-semibold text-foreground w-28">
                  {branch.code}
                  <span className="block text-[9px] text-muted-foreground font-normal">{branch.branchName}</span>
                </td>
                <td className="sticky left-28 z-10 bg-card px-2 py-2 text-center border-r border-border">
                  <span className="text-emerald-600 font-bold">{branch.totalNew}</span>
                  <span className="text-muted-foreground">/</span>
                  <span className="text-rose-500 font-bold">{branch.totalOff}</span>
                  <div><NetBadge net={branch.totalNet} /></div>
                </td>
                {branch.days.map(day => (
                  <td
                    key={day.date}
                    className={`px-1 py-2 text-center ${day.date === today ? 'bg-primary/5' : ''}`}
                  >
                    {(day.newHires > 0 || day.offHires > 0) ? (
                      <div>
                        <div>
                          <span className="text-emerald-600 font-semibold">{day.newHires || '·'}</span>
                          <span className="text-muted-foreground">/</span>
                          <span className="text-rose-500 font-semibold">{day.offHires || '·'}</span>
                        </div>
                        {day.net !== 0 && <NetBadge net={day.net} />}
                      </div>
                    ) : (
                      <span className="text-muted-foreground/30">—</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}

            {/* UAE Total row */}
            <tr className="border-t-2 border-border bg-muted/20 font-semibold">
              <td className="sticky left-0 z-10 bg-muted/20 px-3 py-2 text-foreground w-28">
                UAE Total
              </td>
              <td className="sticky left-28 z-10 bg-muted/20 px-2 py-2 text-center border-r border-border">
                <span className="text-emerald-600 font-bold">{uaeTotalNew}</span>
                <span className="text-muted-foreground">/</span>
                <span className="text-rose-500 font-bold">{uaeTotalOff}</span>
                <div><NetBadge net={uaeTotalNet} /></div>
              </td>
              {uaeTotal.map(day => (
                <td
                  key={day.date}
                  className={`px-1 py-2 text-center ${day.date === today ? 'bg-primary/5' : ''}`}
                >
                  {(day.newHires > 0 || day.offHires > 0) ? (
                    <div>
                      <div>
                        <span className="text-emerald-600 font-bold">{day.newHires || '·'}</span>
                        <span className="text-muted-foreground">/</span>
                        <span className="text-rose-500 font-bold">{day.offHires || '·'}</span>
                      </div>
                      {day.net !== 0 && <NetBadge net={day.net} />}
                    </div>
                  ) : (
                    <span className="text-muted-foreground/30">—</span>
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Footer legend */}
      <div className="border-t border-border px-4 py-2 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="text-emerald-600 font-semibold">N = New Hires</span>
        <span className="text-rose-500 font-semibold">O = Off Hires</span>
        <span>Net = N − O</span>
        <span className="ml-auto">Aggregated from Bookings table — updates live</span>
      </div>
    </Card>
  );
}
