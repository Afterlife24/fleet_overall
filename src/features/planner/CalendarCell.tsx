/**
 * Calendar Cell Component
 * Renders individual day cell in 14-day planner view with exact Excel colors
 */

import { getCellBackgroundColor, getCellStyle, PLANNER_COLORS, getColorName } from '@/constants/plannerColors';
import { cn } from '@/lib/utils';

interface CalendarCellProps {
  date: string;
  booking?: {
    id: string;
    reference: string;
    customerId: string;
    customerName: string;
    startDate: string;
    endDate: string;
    isReplacement?: boolean;
  } | null;
  machineStatus?: 'Available' | 'On Hire' | 'Under Repair' | 'PHI' | 'PDI' | 'In Workshop';
  nextDayCustomer?: string;
  onClick?: () => void;
}

export function CalendarCell({
  date,
  booking,
  machineStatus,
  nextDayCustomer,
  onClick
}: CalendarCellProps) {
  const colorKey = getCellBackgroundColor(
    booking || null,
    date,
    machineStatus,
    nextDayCustomer
  );
  
  const cellStyle = getCellStyle(colorKey);
  
  // Display customer name or status
  const displayText = booking?.customerName || (machineStatus === 'Available' ? '' : machineStatus || '');
  
  return (
    <div
      className={cn(
        "h-14 border border-gray-300 p-1 text-xs font-medium cursor-pointer transition-all",
        "hover:ring-2 hover:ring-blue-400 hover:z-10",
        !displayText && "text-gray-400"
      )}
      style={cellStyle}
      onClick={onClick}
      title={booking ? `${booking.customerName}\n${booking.startDate} → ${booking.endDate}` : getColorName(colorKey)}
    >
      <div className="truncate">
        {displayText}
      </div>
    </div>
  );
}

/**
 * Color Legend Component
 * Shows all planner status colors with exact Excel names
 */
export function ColorLegend() {
  const mainColors = [
    'STARTS_HIRE', 'OFF_HIRE', 'ON_HIRE_SITE', 'FINAL_PDI', 
    'PHI', 'UNDER_REPAIR', 'WORK_IN_PROGRESS', 'AVAILABLE'
  ] as const;
  
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs">
      <h4 className="w-full text-sm font-semibold text-gray-700 mb-1">Color Legend:</h4>
      {mainColors.map((key) => {
        return (
          <div key={key} className="flex items-center gap-2">
            <div 
              className="w-6 h-6 rounded border border-gray-300"
              style={{ backgroundColor: PLANNER_COLORS[key] }}
            />
            <span className="text-gray-600">{getColorName(key)}</span>
          </div>
        );
      })}
    </div>
  );
}
