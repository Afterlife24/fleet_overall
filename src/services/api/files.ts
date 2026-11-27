import type { FileDto, FileMimeType } from '../../../shared/dto/index';
import { API_BASE, apiRequest, type ApiRequestOptions } from './http';

type Opts = Pick<ApiRequestOptions, 'signal'>;

/** `/api/v1/files`. Upload sends the raw bytes with the declared type and `?filename=`. */
export const filesApi = {
  upload: (file: Blob, filename: string, mime: FileMimeType, opts: Opts = {}) =>
    apiRequest<FileDto>('/files', {
      method: 'POST', query: { filename }, rawBody: file, headers: { 'Content-Type': mime }, ...opts,
    }),
  get: (id: string, opts: Opts = {}) => apiRequest<FileDto>(`/files/${encodeURIComponent(id)}`, opts),
  /** Relative URL of the content endpoint. It needs the bearer credential, so fetch it through `apiRequest`, not an `<a href>`. */
  contentPath: (id: string) => `${API_BASE}/files/${encodeURIComponent(id)}/content`,
};
