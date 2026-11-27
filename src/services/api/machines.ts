import type {
  MachineDto, MachineManualStatusDto, OperationalStatus, ReadinessStatus,
} from '../../../shared/dto/index';
import { apiRequest, type ApiRequestOptions } from './http';
import { archiveCall, collectionApi } from './resource';

export interface MachineCreate {
  branchId: string; modelId: string; assetNo: string; fleetNo: string; serialNo: string;
  manufactureYear?: number | null; powerSource?: string | null;
  platformHeightM?: string | number | null; workingHeightM?: string | number | null; capacityKg?: string | number | null;
  hoursOperated?: string | number; operationalStatus?: OperationalStatus; readinessStatus?: ReadinessStatus;
  currentLocation: string;
  lastInspectionOn?: string | null; nextInspectionOn?: string | null; nextPhiOn?: string | null;
  nextMandatoryOn?: string | null; tpcExpiresOn?: string | null; tpcSupplier?: string | null;
  customAttributes?: Record<string, unknown>;
}
/** `active` is changed only by `archive`, not by PATCH. */
export type MachineUpdate = Partial<MachineCreate>;
export interface MachineFilters {
  branchId?: string; status?: OperationalStatus; readiness?: ReadinessStatus; modelId?: string; active?: boolean; q?: string;
}

/** `/api/v1/machines`. `archive` sets active=false (no hard delete). */
export const machinesApi = {
  ...collectionApi<MachineDto, MachineCreate, MachineUpdate, MachineFilters>('/machines'),
  archive: archiveCall<MachineDto>('/machines'),
  /** Audited manual override; the only way to set Allocated, On Hire or Transport directly. */
  setOperationalStatus: (id: string, rowVersion: number, input: MachineManualStatusDto, opts: Pick<ApiRequestOptions, 'signal'> = {}) =>
    apiRequest<MachineDto>(`/machines/${encodeURIComponent(id)}/operational-status`, {
      method: 'POST', body: input, rowVersion, ...opts,
    }),
};
