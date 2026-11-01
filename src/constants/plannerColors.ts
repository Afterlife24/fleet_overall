/**
 * Planner Color Scheme - EXACT from REF-08 Excel Analysis
 * Source: Complete color extraction from REF-08_The_Planner_Hire_Desk.xlsx
 * Official Legend: Z47:Z57 (repeated at Z117:Z127)
 */

// ═══════════════════════════════════════════════════════════════════════════
// DAY CELL STATUS COLORS (Official Legend from Excel Z47:Z57)
// ═══════════════════════════════════════════════════════════════════════════

export const PLANNER_COLORS = {
  // Core booking status colors (from official legend)
  STARTS_HIRE: '#99FF99',        // 🟢 Green - New hire begins
  OFF_HIRE: '#FF99FF',            // 🩷 Pink - Machine coming back / hire ending
  REPLACEMENT: '#8064A2',         // 🟣 Purple (theme:7 tint:-0.25) - Sent as replacement
  ON_HIRE_SITE: '#BFBFBF',       // 🩶 Grey (theme:0 tint:-0.25) - OH - SITE (at client)
  
  // Pre/Post inspection colors
  FINAL_PDI: '#FFFF00',          // 🟡 Yellow - Pre-Despatch Inspection
  PHI: '#FF9933',                // 🟠 Orange - Post-Hire Inspection
  
  // Maintenance/repair colors
  WORK_IN_PROGRESS: '#FF66CC',   // 🩷 Hot Pink - Maintenance ongoing
  UNDER_REPAIR: '#FF0000',       // 🔴 Red - Major repair, machine down
  
  // Available/idle colors
  AVAILABLE: '#FFFFFF',          // ⬜ White - Not on hire, ready
  NOT_ON_HIRE: '#FFFFFF',        // ⬜ White - Machine not rented
  
  // Additional found colors
  LIGHT_GREY: '#D9D9D9',         // Light grey - Unbooked / soft available
  LIGHT_PINK: '#F8D4F4',         // Light pink - Softer WIP / tentative
  TEAL_ACCENT: '#4BACC6',        // Teal - Extension under review
  
  // Default
  DEFAULT: '#FFFFFF',            // White background for empty cells
} as const;

export type PlannerColorKey = keyof typeof PLANNER_COLORS;

/**
 * Get cell background color based on booking status and date position
 */
export function getCellBackgroundColor(
  booking: {
    startDate: string;
    endDate: string;
    customerId: string;
    isReplacement?: boolean;
  } | null,
  date: string,
  machineStatus?: 'Available' | 'On Hire' | 'Under Repair' | 'PHI' | 'PDI' | 'In Workshop',
  nextDayCustomer?: string
): PlannerColorKey {
  // No booking → check machine status
  if (!booking) {
    switch (machineStatus) {
      case 'PDI':
        return 'FINAL_PDI';  // Yellow - Pre-Despatch Inspection
      case 'Under Repair':
        return 'UNDER_REPAIR';  // Red - Major repair
      case 'In Workshop':
        return 'WORK_IN_PROGRESS';  // Hot Pink - Maintenance
      case 'PHI':
        return 'PHI';  // Orange - Post-Hire Inspection
      default:
        return 'AVAILABLE';  // White - Available
    }
  }
  
  const isFirstDay = date === booking.startDate;
  const isLastDay = date === booking.endDate;
  const isMiddleDay = date > booking.startDate && date < booking.endDate;
  
  // FIRST DAY → GREEN (Starts Hire)
  if (isFirstDay) {
    return 'STARTS_HIRE';
  }
  
  // LAST DAY → PINK (Off Hire)
  if (isLastDay) {
    return 'OFF_HIRE';
  }
  
  // MIDDLE DAY
  if (isMiddleDay) {
    // Check if replacement (customer changes next day)
    if (nextDayCustomer && nextDayCustomer !== booking.customerId) {
      return 'REPLACEMENT';  // Purple - Replacement
    }
    
    // Check if flagged as replacement
    if (booking.isReplacement) {
      return 'REPLACEMENT';
    }
    
    // Normal middle day → GRAY (OH - Site)
    return 'ON_HIRE_SITE';
  }
  
  return 'AVAILABLE';  // Default white
}

/**
 * Apply inline style with exact Excel colors
 */
export function getCellStyle(colorKey: PlannerColorKey): React.CSSProperties {
  const bgColor = PLANNER_COLORS[colorKey];
  
  // Determine text color based on background
  const darkBackgrounds: PlannerColorKey[] = ['UNDER_REPAIR', 'PHI', 'REPLACEMENT'];
  const textColor = darkBackgrounds.includes(colorKey) ? '#FFFFFF' : '#000000';
  
  return {
    backgroundColor: bgColor,
    color: textColor,
  };
}

/**
 * Get color name for legend display
 */
/**
 * Get machine row background color based on Engine + Type
 * Matches exact Excel cell fill colors from REF-08
 */
export function getMachineRowColor(powerSource: string, category: string): string {
  // Map powerSource to Engine code
  const engineMap: Record<string, string> = {
    'Diesel': 'D',
    'Electric': 'E',
    'Bi-Energy': 'Bi',
    'Hybrid': 'H',
  };
  
  // Map category to Type code
  const typeMap: Record<string, string> = {
    'Articulating Boom': 'B',
    'Telescopic Boom': 'B',
    'Scissor Lift': 'S',
    'Telehandler': 'C',
    'Vertical Mast': 'C',
    'Trailer Mounted': 'H',
  };
  
  const engine = engineMap[powerSource] || 'D';
  const type = typeMap[category] || 'B';
  const key = `${engine}-${type}`;
  
  // Machine type colors from Excel analysis
  const machineColors: Record<string, string> = {
    'D-B': '#F5E6D3',      // Light tan (231 machines) - Diesel Boom
    'E-S': '#FFFF99',      // Light yellow (105 machines) - Electric Scissor
    'D-S': '#FFE4CC',      // Light salmon (55 machines) - Diesel Scissor
    'E-B': '#F5F5F5',      // Light grey (35 machines) - Electric Boom
    'Bi-C': '#E8F5E0',     // Light green (13 machines) - Bi-fuel Compact
    'Bi-B': '#E0F3F7',     // Light blue (6 machines) - Bi-fuel Boom
    'H-B': '#F7F6F3',      // Warm grey (3 machines) - Hybrid Boom
    'E-C': '#E8F5E0',      // Light green (3 machines) - Electric Compact
  };
  
  return machineColors[key] || '#FFFFFF';  // White default
}

export function getColorName(colorKey: PlannerColorKey): string {
  const names: Record<PlannerColorKey, string> = {
    STARTS_HIRE: 'Starts Hire',
    OFF_HIRE: 'Off Hire',
    REPLACEMENT: 'Replacement',
    ON_HIRE_SITE: 'OH - Site',
    FINAL_PDI: 'Final PDI',
    PHI: 'PHI',
    WORK_IN_PROGRESS: 'Work In Progress',
    UNDER_REPAIR: 'Under Repair',
    AVAILABLE: 'Available',
    NOT_ON_HIRE: 'Not on Hire',
    LIGHT_GREY: 'Unbooked',
    LIGHT_PINK: 'Tentative',
    TEAL_ACCENT: 'Extension',
    DEFAULT: 'Default',
  };
  return names[colorKey] || colorKey;
}
