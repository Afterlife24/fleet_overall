import type { MachineModelDto } from '../../../shared/dto/index';
import { collectionApi } from './resource';

export interface MachineModelInput {
  make: string; model: string; category: string; powerSource?: string | null;
  platformHeightM?: string | number | null; workingHeightM?: string | number | null; capacityKg?: string | number | null;
  specifications?: Record<string, unknown>;
}

/** `/api/v1/machine-models` (no delete endpoint). */
export const machineModelsApi = collectionApi<MachineModelDto, MachineModelInput, Partial<MachineModelInput>, { q?: string }>('/machine-models');
