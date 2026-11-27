export const FILE_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const;
export type FileMimeType = (typeof FILE_MIME_TYPES)[number];

export type FileStorageState = 'Pending' | 'Verified' | 'Failed';
export type FileScanStatus = 'Pending' | 'Clean' | 'Rejected' | 'Failed';

/** Response of `POST /api/v1/files` and `GET /api/v1/files/:id`. No object key or storage path is exposed. */
export interface FileDto {
  id: string;
  originalName: string;
  declaredMime: FileMimeType;
  detectedMime: FileMimeType | null;
  expectedSize: number;
  byteSize: number | null;
  sha256: string | null;
  storageState: FileStorageState;
  scanStatus: FileScanStatus;
  createdAt: string;
}
