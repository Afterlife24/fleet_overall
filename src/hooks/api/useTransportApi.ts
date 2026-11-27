// React Query hooks for Transport (jobs, drivers, trucks) over `/api/v1`. Reads wait for the API session,
// writes send the row version as `If-Match` (status changes go through the status endpoint) and creates carry
// one Idempotency-Key per submission. There is no mock fallback: a failed read is an error.
import { useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys as legacyKeys } from '@/hooks/useQueries';
import { useApiBranches, useApiReady, useFleetMachines } from '@/hooks/useApiResources';
import { useQueryScope, type QueryScope } from '@/services/api/queryKeys';
import { listAll } from '@/services/api/readAdapters';
import {
  driversApi, transportJobsApi, transportVehiclesApi,
  type DriverCreate, type DriverDto, type DriverUpdate, type TransportJobCreate, type TransportJobDto,
  type TransportJobStatusValue, type TransportJobUpdate, type TransportVehicleCreate, type TransportVehicleDto,
  type TransportVehicleUpdate,
} from '@/services/api/transport';
import {
  driverFromDto, transportJobFromDto, transportRecordFromView, truckFromDto,
  type ApiTransportJobView, type ApiTruck,
} from '@/services/api/transportMappers';
import { useAuthStore, JA_ORG_ID } from '@/store/authStore';
import { useTransportStore } from '@/store/transportStore';
import type { Driver } from '@/types/transport';

const jobKeys = {
  all: (s: QueryScope) => ['transport-jobs', s.orgId, s.branch] as const,
  list: (s: QueryScope) => ['transport-jobs', s.orgId, s.branch, 'list'] as const,
};
const driverKeys = {
  all: (s: QueryScope) => ['drivers', s.orgId, s.branch] as const,
  list: (s: QueryScope) => ['drivers', s.orgId, s.branch, 'list'] as const,
};
const vehicleKeys = {
  all: (s: QueryScope) => ['transport-vehicles', s.orgId, s.branch] as const,
  list: (s: QueryScope) => ['transport-vehicles', s.orgId, s.branch, 'list'] as const,
};

/** Refreshes everything that shows transport jobs, including the retained legacy readers. */
export function useInvalidateTransport() {
  const qc = useQueryClient();
  const scope = useQueryScope();
  return {
    jobs: () => {
      void qc.invalidateQueries({ queryKey: jobKeys.all(scope) });
      void qc.invalidateQueries({ queryKey: legacyKeys.transportJobs });
    },
    drivers: () => { void qc.invalidateQueries({ queryKey: driverKeys.all(scope) }); },
    vehicles: () => { void qc.invalidateQueries({ queryKey: vehicleKeys.all(scope) }); },
  };
}

// -- Raw reads ------------------------------------------------------------------------------------------------
export function useApiTransportJobs() {
  const scope = useQueryScope();
  const ready = useApiReady();
  return useQuery<TransportJobDto[]>({
    queryKey: jobKeys.list(scope),
    queryFn: () => listAll((page, pageSize) => transportJobsApi.list({ page, pageSize, sort: '-scheduledAt' })),
    enabled: ready,
  });
}

export function useApiDrivers() {
  const scope = useQueryScope();
  const ready = useApiReady();
  return useQuery<DriverDto[]>({
    queryKey: driverKeys.list(scope),
    queryFn: () => listAll((page, pageSize) => driversApi.list({ page, pageSize })),
    enabled: ready,
  });
}

export function useApiTransportVehicles() {
  const scope = useQueryScope();
  const ready = useApiReady();
  return useQuery<TransportVehicleDto[]>({
    queryKey: vehicleKeys.list(scope),
    queryFn: () => listAll((page, pageSize) => transportVehiclesApi.list({ page, pageSize })),
    enabled: ready,
  });
}

// -- Views the screens render ---------------------------------------------------------------------------------
export function useBranchNameMap(): ReadonlyMap<string, string> {
  const { data } = useApiBranches();
  return useMemo(() => new Map((data ?? []).map((b) => [b.id, b.name])), [data]);
}

/** Drivers with their branch names. */
export function useDriverViews() {
  const query = useApiDrivers();
  const branchNames = useBranchNameMap();
  const data = useMemo<Driver[] | undefined>(
    () => query.data?.map((d) => driverFromDto(d, branchNames)),
    [query.data, branchNames],
  );
  return { ...query, data };
}

/** Trucks (transport vehicles) with their branch names. */
export function useTruckViews() {
  const query = useApiTransportVehicles();
  const branchNames = useBranchNameMap();
  const data = useMemo<ApiTruck[] | undefined>(
    () => query.data?.map((v) => truckFromDto(v, branchNames)),
    [query.data, branchNames],
  );
  return { ...query, data };
}

/**
 * Transport jobs (manual and collection-generated, one list) with driver, truck, machine and branch names.
 * Also refreshes the non-persisted in-memory copy that the retained legacy readers use.
 */
export function useTransportJobViews() {
  const jobs = useApiTransportJobs();
  const drivers = useApiDrivers();
  const vehicles = useApiTransportVehicles();
  const machines = useFleetMachines();
  const branchNames = useBranchNameMap();
  const orgId = useAuthStore((s) => s.user?.orgId ?? JA_ORG_ID);
  const qc = useQueryClient();
  const ready = useApiReady();

  const data = useMemo<ApiTransportJobView[] | undefined>(() => {
    if (!jobs.data) return undefined;
    return jobs.data.map((j) => transportJobFromDto(j, {
      orgId,
      machines: new Map((machines.data ?? []).map((m) => [m.id, m])),
      drivers: new Map((drivers.data ?? []).map((d) => [d.id, d])),
      vehicles: new Map((vehicles.data ?? []).map((v) => [v.id, v])),
      branchNames,
    }));
  }, [jobs.data, machines.data, drivers.data, vehicles.data, branchNames, orgId]);

  useEffect(() => {
    useTransportStore.getState().setJobs(ready && data ? data.map(transportRecordFromView) : []);
    void qc.invalidateQueries({ queryKey: legacyKeys.transportJobs });
  }, [ready, data, qc]);

  return {
    data,
    isLoading: jobs.isLoading,
    isError: jobs.isError,
    error: jobs.error,
    refetch: () => { void jobs.refetch(); void drivers.refetch(); void vehicles.refetch(); },
  };
}

// -- Jobs -------------------------------------------------------------------------------------------------------
export function useCreateTransportJobApi() {
  const inv = useInvalidateTransport();
  return useMutation({
    mutationFn: ({ body, submissionId }: { body: TransportJobCreate; submissionId: string }) =>
      transportJobsApi.create(body, submissionId),
    onSuccess: inv.jobs,
  });
}

export function useUpdateTransportJobApi() {
  const inv = useInvalidateTransport();
  return useMutation({
    mutationFn: ({ id, rowVersion, patch }: { id: string; rowVersion: number; patch: TransportJobUpdate }) =>
      transportJobsApi.update(id, rowVersion, patch),
    onSuccess: inv.jobs,
  });
}

/** Status changes use the status endpoint (never a plain update). */
export function useChangeTransportJobStatus() {
  const inv = useInvalidateTransport();
  return useMutation({
    mutationFn: ({ id, rowVersion, status, reason }: {
      id: string; rowVersion: number; status: TransportJobStatusValue; reason?: string;
    }) => transportJobsApi.changeStatus(id, rowVersion, { status, ...(reason ? { reason } : {}) }),
    onSuccess: inv.jobs,
  });
}

/** Reads the latest job (used by the conflict "Reload latest" action). */
export function fetchTransportJob(id: string): Promise<TransportJobDto> {
  return transportJobsApi.get(id);
}

// -- Drivers and trucks ------------------------------------------------------------------------------------------
export function useCreateDriver() {
  const inv = useInvalidateTransport();
  return useMutation({
    mutationFn: ({ body, submissionId }: { body: DriverCreate; submissionId: string }) => driversApi.create(body, submissionId),
    onSuccess: inv.drivers,
  });
}

export function useUpdateDriver() {
  const inv = useInvalidateTransport();
  return useMutation({
    mutationFn: ({ id, rowVersion, patch }: { id: string; rowVersion: number; patch: DriverUpdate }) =>
      driversApi.update(id, rowVersion, patch),
    onSuccess: inv.drivers,
  });
}

export function useCreateTransportVehicle() {
  const inv = useInvalidateTransport();
  return useMutation({
    mutationFn: ({ body, submissionId }: { body: TransportVehicleCreate; submissionId: string }) =>
      transportVehiclesApi.create(body, submissionId),
    onSuccess: inv.vehicles,
  });
}

export function useUpdateTransportVehicle() {
  const inv = useInvalidateTransport();
  return useMutation({
    mutationFn: ({ id, rowVersion, patch }: { id: string; rowVersion: number; patch: TransportVehicleUpdate }) =>
      transportVehiclesApi.update(id, rowVersion, patch),
    onSuccess: inv.vehicles,
  });
}

