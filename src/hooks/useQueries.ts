import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  machineService, bookingService, workshopService, transportService,
  inspectionService, breakdownService, jobCardService, userService,
  notificationService, branchService, customerService, dashboardService, reportService, gateService,
  sixSigmaService, crossHireService, customerANIService, hireAgreementService, taxInvoiceService,
} from '@/services/services';
import { useBranchStore } from '@/store/branchStore';

export const queryKeys = {
  machines: ['machines'] as const,
  machine: (id: string) => ['machine', id] as const,
  bookings: ['bookings'] as const,
  workshopJobs: ['workshop-jobs'] as const,
  technicians: ['technicians'] as const,
  bays: ['bays'] as const,
  transportJobs: ['transport-jobs'] as const,
  drivers: ['drivers'] as const,
  trucks: ['trucks'] as const,
  inspections: ['inspections'] as const,
  inspectionsByType: (type: string) => ['inspections', type] as const,
  breakdowns: ['breakdowns'] as const,
  jobCards: ['job-cards'] as const,
  users: ['users'] as const,
  notifications: ['notifications'] as const,
  branches: ['branches'] as const,
  customers: ['customers'] as const,
  gateEntries: ['gate-entries'] as const,
  kpis: (branchId: string) => ['kpis', branchId] as const,
  fleetByCategory: (branchId: string) => ['fleet-by-category', branchId] as const,
  fleetByStatus: (branchId: string) => ['fleet-by-status', branchId] as const,
  branchUtilization: (branchId: string) => ['branch-utilization', branchId] as const,
  workshopPerformance: (branchId: string) => ['workshop-performance', branchId] as const,
  recentActivity: (branchId: string) => ['recent-activity', branchId] as const,
  reportSummary: (period: string) => ['report-summary', period] as const,
  revenueTrend: (period: string) => ['revenue-trend', period] as const,
  branchPerformance: ['branch-performance'] as const,
  workshopReport: ['workshop-report'] as const,
  transportReport: ['transport-report'] as const,
  breakdownReport: ['breakdown-report'] as const,
  sixSigmaMetrics: (branchId: string) => ['six-sigma-metrics', branchId] as const,
  crossHires: ['cross-hires'] as const,
  crossHire: (id: string) => ['cross-hire', id] as const,
  crossHireStats: (branchId: string) => ['cross-hire-stats', branchId] as const,
  customerANIs: ['customer-anis'] as const,
  taxInvoices: ['tax-invoices'] as const,
  hireAgreements: ['hire-agreements'] as const,
  hireAgreement: (id: string) => ['hire-agreement', id] as const,
  customerANI: (id: string) => ['customer-ani', id] as const,
};

export function useMachines() {
  return useQuery({ queryKey: queryKeys.machines, queryFn: machineService.list });
}
export function useMachine(id: string | undefined) {
  return useQuery({ queryKey: queryKeys.machine(id || ''), queryFn: () => machineService.get(id!), enabled: !!id });
}
export function useBookings() {
  return useQuery({ queryKey: queryKeys.bookings, queryFn: bookingService.list });
}
export function useWorkshopJobs() {
  return useQuery({ queryKey: queryKeys.workshopJobs, queryFn: workshopService.listJobs });
}
export function useTechnicians() {
  return useQuery({ queryKey: queryKeys.technicians, queryFn: workshopService.listTechnicians });
}
export function useBays() {
  return useQuery({ queryKey: queryKeys.bays, queryFn: workshopService.listBays });
}
export function useTransportJobs() {
  return useQuery({ queryKey: queryKeys.transportJobs, queryFn: transportService.listJobs });
}
export function useDrivers() {
  return useQuery({ queryKey: queryKeys.drivers, queryFn: transportService.listDrivers });
}
export function useTrucks() {
  return useQuery({ queryKey: queryKeys.trucks, queryFn: transportService.listTrucks });
}
export function useInspections() {
  return useQuery({ queryKey: queryKeys.inspections, queryFn: inspectionService.list });
}
export function useInspectionsByType(type: string) {
  return useQuery({ queryKey: queryKeys.inspectionsByType(type), queryFn: () => inspectionService.byType(type) });
}
export function useBreakdowns() {
  return useQuery({ queryKey: queryKeys.breakdowns, queryFn: breakdownService.list });
}
export function useJobCards() {
  return useQuery({ queryKey: queryKeys.jobCards, queryFn: jobCardService.list });
}
export function useUsers() {
  return useQuery({ queryKey: queryKeys.users, queryFn: userService.list });
}
export function useNotifications() {
  return useQuery({ queryKey: queryKeys.notifications, queryFn: notificationService.list });
}
export function useBranches() {
  return useQuery({ queryKey: queryKeys.branches, queryFn: branchService.list });
}
export function useCreateBranch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => branchService.create(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.branches }); },
  });
}
export function useUpdateBranch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => branchService.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.branches }); },
  });
}
export function useDeleteBranch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => branchService.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.branches }); },
  });
}
export function useCustomers() {
  return useQuery({ queryKey: queryKeys.customers, queryFn: customerService.list });
}
export function useGateEntries() {
  return useQuery({ queryKey: queryKeys.gateEntries, queryFn: gateService.list });
}
export function useKPIs() {
  const branchId = useBranchStore((s) => s.selectedBranchId);
  return useQuery({ queryKey: queryKeys.kpis(branchId), queryFn: () => dashboardService.getKPIs(branchId) });
}
export function useFleetByCategory() {
  const branchId = useBranchStore((s) => s.selectedBranchId);
  return useQuery({ queryKey: queryKeys.fleetByCategory(branchId), queryFn: () => dashboardService.getFleetByCategory(branchId) });
}
export function useFleetByStatus() {
  const branchId = useBranchStore((s) => s.selectedBranchId);
  return useQuery({ queryKey: queryKeys.fleetByStatus(branchId), queryFn: () => dashboardService.getFleetByStatus(branchId) });
}
export function useBranchUtilization() {
  const branchId = useBranchStore((s) => s.selectedBranchId);
  return useQuery({ queryKey: queryKeys.branchUtilization(branchId), queryFn: () => dashboardService.getBranchUtilization(branchId) });
}
export function useWorkshopPerformance() {
  const branchId = useBranchStore((s) => s.selectedBranchId);
  return useQuery({ queryKey: queryKeys.workshopPerformance(branchId), queryFn: () => dashboardService.getWorkshopPerformance(branchId) });
}
export function useRecentActivity() {
  const branchId = useBranchStore((s) => s.selectedBranchId);
  return useQuery({ queryKey: queryKeys.recentActivity(branchId), queryFn: () => dashboardService.getRecentActivity(branchId) });
}
export function useReportSummary(period: 'daily' | 'weekly' | 'monthly') {
  return useQuery({
    queryKey: queryKeys.reportSummary(period),
    queryFn: () => {
      if (period === 'daily') return reportService.getDailySummary();
      if (period === 'weekly') return reportService.getWeeklySummary();
      return reportService.getMonthlySummary();
    },
  });
}
export function useRevenueTrend(period: 'daily' | 'weekly' | 'monthly') {
  return useQuery({ queryKey: queryKeys.revenueTrend(period), queryFn: () => reportService.getRevenueTrend(period) });
}
export function useBranchPerformance() {
  return useQuery({ queryKey: queryKeys.branchPerformance, queryFn: reportService.getBranchPerformance });
}
export function useWorkshopReport() {
  return useQuery({ queryKey: queryKeys.workshopReport, queryFn: reportService.getWorkshopReport });
}
export function useTransportReport() {
  return useQuery({ queryKey: queryKeys.transportReport, queryFn: reportService.getTransportReport });
}
export function useBreakdownReport() {
  return useQuery({ queryKey: queryKeys.breakdownReport, queryFn: reportService.getBreakdownReport });
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// MUTATION HOOKS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// â”€â”€ Machine Mutations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function useCreateMachine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: machineService.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.machines });
      queryClient.invalidateQueries({ queryKey: ['kpis'] });
      queryClient.invalidateQueries({ queryKey: ['fleet-by-category'] });
      queryClient.invalidateQueries({ queryKey: ['fleet-by-status'] });
    },
  });
}

export function useUpdateMachine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => machineService.update(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.machines });
      queryClient.invalidateQueries({ queryKey: queryKeys.machine(variables.id) });
      queryClient.invalidateQueries({ queryKey: ['kpis'] });
    },
  });
}

export function useUpdateMachineStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => machineService.updateStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.machines });
      queryClient.invalidateQueries({ queryKey: ['kpis'] });
      queryClient.invalidateQueries({ queryKey: ['fleet-by-status'] });
    },
  });
}

export function useDeleteMachine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: machineService.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.machines });
      queryClient.invalidateQueries({ queryKey: ['kpis'] });
    },
  });
}

// â”€â”€ Booking Mutations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function useCreateBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: bookingService.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings });
      queryClient.invalidateQueries({ queryKey: queryKeys.machines });
    },
  });
}

export function useUpdateBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => bookingService.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings });
    },
  });
}

export function useUpdateBookingStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => bookingService.updateStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings });
      queryClient.invalidateQueries({ queryKey: queryKeys.machines });
    },
  });
}

export function useDeleteBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: bookingService.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.bookings });
    },
  });
}

// â”€â”€ Workshop Mutations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function useCreateWorkshopJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: workshopService.createJob,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workshopJobs });
      queryClient.invalidateQueries({ queryKey: queryKeys.machines });
    },
  });
}

export function useUpdateWorkshopJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => workshopService.updateJob(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workshopJobs });
    },
  });
}

export function useUpdateWorkshopJobStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => workshopService.updateJobStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workshopJobs });
      queryClient.invalidateQueries({ queryKey: queryKeys.machines });
      queryClient.invalidateQueries({ queryKey: ['kpis'] });
    },
  });
}

export function useAssignTechnician() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, technicianId }: { jobId: string; technicianId: string }) =>
      workshopService.assignTechnician(jobId, technicianId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workshopJobs });
    },
  });
}

// â”€â”€ Breakdown Mutations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function useCreateBreakdown() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: breakdownService.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.breakdowns });
      queryClient.invalidateQueries({ queryKey: queryKeys.machines });
      queryClient.invalidateQueries({ queryKey: ['kpis'] });
    },
  });
}

export function useUpdateBreakdown() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => breakdownService.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.breakdowns });
    },
  });
}

export function useUpdateBreakdownStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => breakdownService.updateStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.breakdowns });
      queryClient.invalidateQueries({ queryKey: ['kpis'] });
    },
  });
}

export function useAssignBreakdownTechnician() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, technicianId }: { id: string; technicianId: string }) =>
      breakdownService.assignTechnician(id, technicianId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.breakdowns });
    },
  });
}

// â”€â”€ Inspection Mutations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function useUpdateInspection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => inspectionService.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.inspections });
    },
  });
}

export function useUpdateInspectionChecklist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, checklist }: { id: string; checklist: any }) => inspectionService.updateChecklist(id, checklist),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.inspections });
    },
  });
}

export function useSubmitInspection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: inspectionService.submit,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.inspections });
      queryClient.invalidateQueries({ queryKey: queryKeys.machines });
    },
  });
}

// â”€â”€ Gate Mutations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function useApproveGateEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: gateService.approve,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.gateEntries });
    },
  });
}

export function useCompleteGateEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: gateService.complete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.gateEntries });
      queryClient.invalidateQueries({ queryKey: queryKeys.machines });
    },
  });
}

// â”€â”€ User Mutations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: userService.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users });
    },
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => userService.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users });
    },
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: userService.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users });
    },
  });
}

// â”€â”€ Gate Entry Mutations (Create) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function useCreateGateEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: gateService.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.gateEntries });
      queryClient.invalidateQueries({ queryKey: ['kpis'] });
    },
  });
}

// â”€â”€ Transport Job Mutations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function useCreateTransportJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: transportService.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.transportJobs });
      queryClient.invalidateQueries({ queryKey: ['kpis'] });
    },
  });
}

export function useUpdateTransportJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => transportService.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.transportJobs });
    },
  });
}

export function useUpdateTransportJobStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => transportService.updateStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.transportJobs });
      queryClient.invalidateQueries({ queryKey: ['kpis'] });
    },
  });
}

// â”€â”€ Job Card Mutations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function useCreateJobCard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => jobCardService.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.jobCards });
      queryClient.invalidateQueries({ queryKey: queryKeys.machines });
      queryClient.invalidateQueries({ queryKey: ['kpis'] });
    },
  });
}

export function useUpdateJobCard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => jobCardService.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.jobCards });
    },
  });
}

// â”€â”€ Inspection Create Mutations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function useCreatePHIInspection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => inspectionService.createPHI(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.inspections });
      queryClient.invalidateQueries({ queryKey: queryKeys.machines });
      queryClient.invalidateQueries({ queryKey: queryKeys.jobCards });
      queryClient.invalidateQueries({ queryKey: ['kpis'] });
    },
  });
}

export function useCreatePDIInspection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => inspectionService.createPDI(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.inspections });
      queryClient.invalidateQueries({ queryKey: queryKeys.machines });
      queryClient.invalidateQueries({ queryKey: ['kpis'] });
    },
  });
}

export function useCreateMandatoryChecks() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => inspectionService.createMandatory(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.inspections });
      queryClient.invalidateQueries({ queryKey: queryKeys.machines });
    },
  });
}

export function useCreateMQD() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => inspectionService.createMQD(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.inspections });
    },
  });
}

// â”€â”€ Cross Hire â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function useCrossHires() {
  return useQuery({ queryKey: queryKeys.crossHires, queryFn: crossHireService.list });
}
export function useCrossHire(id: string | undefined) {
  return useQuery({ queryKey: queryKeys.crossHire(id || ''), queryFn: () => crossHireService.get(id!), enabled: !!id });
}
export function useCrossHireStats() {
  const branchId = useBranchStore((s) => s.selectedBranchId);
  return useQuery({ queryKey: queryKeys.crossHireStats(branchId), queryFn: () => crossHireService.getStats(branchId) });
}

export function useCreateCrossHire() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => crossHireService.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.crossHires });
      queryClient.invalidateQueries({ queryKey: ['cross-hire-stats'] });
    },
  });
}

export function useUpdateCrossHire() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => crossHireService.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.crossHires });
      queryClient.invalidateQueries({ queryKey: ['cross-hire-stats'] });
    },
  });
}

export function useUpdateCrossHireStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: any }) => crossHireService.updateStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.crossHires });
      queryClient.invalidateQueries({ queryKey: ['cross-hire-stats'] });
    },
  });
}

// Six Sigma metrics
export function useSixSigmaMetrics() {
  const branchId = useBranchStore((s) => s.selectedBranchId);
  return useQuery({
    queryKey: queryKeys.sixSigmaMetrics(branchId),
    queryFn: () => sixSigmaService.getMetrics(branchId),
  });
}

// â”€â”€ Customer ANI â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function useCustomerANIs() {
  return useQuery({ queryKey: queryKeys.customerANIs, queryFn: customerANIService.list });
}

export function useCustomerANI(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.customerANI(id || ''),
    queryFn: () => customerANIService.get(id!),
    enabled: !!id,
  });
}

export function useCreateCustomerANI() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => customerANIService.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.customerANIs });
    },
  });
}

export function useUpdateCustomerANI() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => customerANIService.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.customerANIs });
    },
  });
}

export function useDeleteCustomerANI() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => customerANIService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.customerANIs });
    },
  });
}

// ── Hire Agreement ─────────────────────────────────────────────────────────

export function useHireAgreements() {
  return useQuery({ queryKey: queryKeys.hireAgreements, queryFn: hireAgreementService.list });
}

export function useHireAgreement(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.hireAgreement(id || ''),
    queryFn: () => hireAgreementService.get(id!),
    enabled: !!id,
  });
}

export function useCreateHireAgreement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => hireAgreementService.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: queryKeys.hireAgreements }); },
  });
}

export function useUpdateHireAgreement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => hireAgreementService.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: queryKeys.hireAgreements }); },
  });
}

export function useDeleteHireAgreement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => hireAgreementService.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: queryKeys.hireAgreements }); },
  });
}

// -- Tax Invoice -------------------------------------------------------------

export function useTaxInvoices() {
  return useQuery({ queryKey: queryKeys.taxInvoices, queryFn: taxInvoiceService.list });
}

export function useCreateTaxInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => taxInvoiceService.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: queryKeys.taxInvoices }); },
  });
}

export function useUpdateTaxInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => taxInvoiceService.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: queryKeys.taxInvoices }); },
  });
}

export function useDeleteTaxInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => taxInvoiceService.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: queryKeys.taxInvoices }); },
  });
}