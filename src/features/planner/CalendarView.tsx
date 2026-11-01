/**
 * 14-Day Calendar View Component
 * Exact replica of Excel planner layout with same colors
 */

import { useState, useMemo } from 'react';
import { format, addDays, parseISO } from 'date-fns';
import { CalendarCell, ColorLegend } from './CalendarCell';
import { getMachineRowColor } from '@/constants/plannerColors';
import { useMachines, useBookings } from '@/hooks/useQueries';
import { useBranchFilter } from '@/hooks/useBranchFilter';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export function CalendarView() {
  const { data: allMachines } = useMachines();
  const { data: allBookings } = useBookings();
  
  // Filter by current branch (but show all branches if admin)
  const machines = useBranchFilter(allMachines);
  const bookings = useBranchFilter(allBookings);
  
  const [baseDate, setBaseDate] = useState(new Date());
  
  // Generate 14 days from base date (matching Excel 2-week view)
  const days = useMemo(() => {
    return Array.from({ length: 14 }, (_, i) => {
      const date = addDays(baseDate, i);
      return {
        date,
        dateStr: format(date, 'yyyy-MM-dd'),
        dayName: format(date, 'EEE'),
        dayNum: format(date, 'd'),
      };
    });
  }, [baseDate]);
  
  // Sort machines: Booked first, then Available, then Breakdown/Repair
  const sortedMachines = useMemo(() => {
    if (!machines || !bookings) return [];
    
    return [...machines].sort((a, b) => {
      // Check if machine has bookings in visible date range
      const aHasBooking = bookings.some(booking => 
        booking.machineId === a.id &&
        new Date(booking.endDate) >= new Date(days[0]?.dateStr) &&
        new Date(booking.startDate) <= new Date(days[days.length - 1]?.dateStr)
      );
      const bHasBooking = bookings.some(booking => 
        booking.machineId === b.id &&
        new Date(booking.endDate) >= new Date(days[0]?.dateStr) &&
        new Date(booking.startDate) <= new Date(days[days.length - 1]?.dateStr)
      );
      
      // Priority: 1=Booked, 2=Available, 3=Breakdown/Repair
      const getPriority = (machine: typeof a, hasBooking: boolean) => {
        if (hasBooking) return 1;  // Booked machines first
        if (machine.status === 'Available' || machine.status === 'PDI') return 2;  // Available second
        return 3;  // Breakdown/Repair/Under Repair last
      };
      
      const aPriority = getPriority(a, aHasBooking);
      const bPriority = getPriority(b, bHasBooking);
      
      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      }
      
      // Within same priority, sort by asset number
      return (a.assetNumber || '').localeCompare(b.assetNumber || '');
    });
  }, [machines, bookings, days]);
  
  // Move calendar forward/backward by 7 days
  const movePrevWeek = () => setBaseDate(d => addDays(d, -7));
  const moveNextWeek = () => setBaseDate(d => addDays(d, 7));
  const moveToToday = () => setBaseDate(new Date());
  
  // Get booking for machine on specific date
  const getBookingForDate = (machineId: string, dateStr: string) => {
    return bookings?.find(b =>
      b.machineId === machineId &&
      dateStr >= b.startDate &&
      dateStr <= b.endDate
    );
  };
  
  // Get next day's customer to detect replacements
  const getNextDayCustomer = (machineId: string, dateStr: string) => {
    const nextDate = format(addDays(parseISO(dateStr), 1), 'yyyy-MM-dd');
    const nextBooking = getBookingForDate(machineId, nextDate);
    return nextBooking?.customerName;
  };
  
  return (
    <div className="space-y-4">
      {/* DEBUG INFO */}
      <div className="bg-blue-50 border border-blue-200 p-3 rounded text-sm">
        <strong>Debug:</strong> Machines loaded: {machines?.length || 0} | Bookings loaded: {bookings?.length || 0}
        {machines && machines.length > 0 && ` | First machine: ${machines[0].assetNumber}`}
      </div>
      
      {/* Calendar Controls */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={movePrevWeek}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous Week
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={moveToToday}
            >
              Today
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={moveNextWeek}
            >
              Next Week
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="text-sm font-medium text-gray-700">
            {format(baseDate, 'MMM d, yyyy')} - {format(addDays(baseDate, 13), 'MMM d, yyyy')}
          </div>
        </div>
        
        {/* Color Legend */}
        <ColorLegend />
      </Card>
      
      {/* Calendar Table */}
      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-100 border-b-2 border-gray-300">
                {/* Machine column header */}
                <th className="sticky left-0 z-20 bg-gray-100 p-3 text-left border-r-2 border-gray-300 min-w-[200px]">
                  <div className="font-semibold text-sm text-gray-700">Machine</div>
                  <div className="text-xs text-gray-500">Model / Fleet #</div>
                </th>
                
                {/* Day headers */}
                {days.map((day, idx) => (
                  <th
                    key={day.dateStr}
                    className={cn(
                      "p-2 text-center border-r border-gray-200 min-w-[100px]",
                      day.dayName === 'Sun' && "bg-gray-50"
                    )}
                  >
                    <div className="font-semibold text-sm text-gray-900">
                      {day.dayName.toUpperCase()}
                    </div>
                    <div className="text-xs text-gray-600">{day.dayNum}</div>
                  </th>
                ))}
              </tr>
            </thead>
            
            <tbody>
              {sortedMachines?.map((machine, machineIdx) => {
                const rowBgColor = getMachineRowColor(machine.powerSource, machine.category);
                
                return (
                  <tr
                    key={machine.id}
                    className="border-b border-gray-200"
                  >
                    {/* Machine info column */}
                    <td 
                      className="sticky left-0 z-10 border-r-2 border-gray-300 p-3"
                      style={{ backgroundColor: rowBgColor }}
                    >
                    <div className="font-semibold text-sm text-gray-900">
                      {machine.assetNumber}
                    </div>
                    <div className="text-xs text-gray-600 truncate" title={machine.model}>
                      {machine.model}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {machine.category} · {machine.powerSource}
                    </div>
                  </td>
                  
                  {/* Day cells */}
                  {days.map((day) => {
                    const booking = getBookingForDate(machine.id, day.dateStr);
                    const nextDayCustomer = getNextDayCustomer(machine.id, day.dateStr);
                    
                    return (
                      <td key={day.dateStr} className="p-0 border-r border-gray-200">
                        <CalendarCell
                          date={day.dateStr}
                          booking={booking ? {
                            id: booking.id,
                            reference: booking.reference,
                            customerId: booking.customerId,
                            customerName: booking.customerName,
                            startDate: booking.startDate,
                            endDate: booking.endDate,
                            isReplacement: (booking as any).isReplacement
                          } : null}
                          machineStatus={
                            machine.status === 'Available' || 
                            machine.status === 'On Hire' || 
                            machine.status === 'Under Repair' || 
                            machine.status === 'In Workshop' || 
                            machine.status === 'PDI' || 
                            machine.status === 'PHI' 
                              ? machine.status 
                              : undefined
                          }
                          nextDayCustomer={nextDayCustomer}
                          onClick={() => {
                            if (booking) {
                              console.log('Booking clicked:', booking);
                              // TODO: Open booking details dialog
                            }
                          }}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
              })}
            </tbody>
          </table>
        </div>
        
        {/* Summary footer */}
        <div className="bg-gray-50 border-t-2 border-gray-300 p-3 text-xs text-gray-600">
          <div className="flex items-center justify-between">
            <div>
              Total Machines: <span className="font-semibold">{sortedMachines?.length || 0}</span>
            </div>
            <div>
              Active Bookings: <span className="font-semibold">
                {bookings?.filter(b => b.status !== 'Reserved' && b.status !== 'Cancelled').length || 0}
              </span>
            </div>
            <div>
              Showing: <span className="font-semibold">{days[0].dayName} {days[0].dayNum}</span> to{' '}
              <span className="font-semibold">{days[13].dayName} {days[13].dayNum}</span>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

// Helper
function cn(...classes: (string | undefined | false)[]) {
  return classes.filter(Boolean).join(' ');
}
