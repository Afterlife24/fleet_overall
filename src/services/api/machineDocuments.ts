import type { MachineDocumentDto, MachineDocumentType } from '../../../shared/dto/index';
import { apiRequest, type ApiRequestOptions } from './http';

type Opts = Pick<ApiRequestOptions, 'signal'>;

export interface MachineDocumentCreate {
  fileId: string; name: string; documentType: MachineDocumentType; expiresOn?: string | null;
}
export interface MachineDocumentFilters { active?: boolean; documentType?: MachineDocumentType }

const base = (machineId: string) => `/machines/${encodeURIComponent(machineId)}/documents`;

/** `/api/v1/machines/:id/documents`. Documents are deactivated, never deleted. */
export const machineDocumentsApi = {
  list: (machineId: string, filters: MachineDocumentFilters = {}, opts: Opts = {}) =>
    apiRequest<{ items: MachineDocumentDto[]; documentTypes: MachineDocumentType[] }>(base(machineId), { query: filters, ...opts }),
  get: (machineId: string, docId: string, opts: Opts = {}) =>
    apiRequest<MachineDocumentDto>(`${base(machineId)}/${encodeURIComponent(docId)}`, opts),
  create: (machineId: string, body: MachineDocumentCreate, submissionId: string, opts: Opts = {}) =>
    apiRequest<MachineDocumentDto>(base(machineId), { method: 'POST', body, submissionId, ...opts }),
  deactivate: (machineId: string, docId: string, rowVersion: number, opts: Opts = {}) =>
    apiRequest<MachineDocumentDto>(`${base(machineId)}/${encodeURIComponent(docId)}`, { method: 'DELETE', rowVersion, ...opts }),
};
