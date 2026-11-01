export interface ReportDataset {
  label: string;
  value: number;
  color?: string;
}

export interface TimeSeriesPoint {
  date: string;
  value: number;
  secondary?: number;
}

export interface ReportSummary {
  totalRevenue: number;
  utilizationRate: number;
  totalHires: number;
  totalBreakdowns: number;
  avgRepairTime: number;
  fleetAvailability: number;
}

export interface BranchPerformance {
  branch: string;
  utilization: number;
  revenue: number;
  machines: number;
  breakdowns: number;
}
