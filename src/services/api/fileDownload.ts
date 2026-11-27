import { ApiClientError, mapErrorBody, SERVICE_UNAVAILABLE_MESSAGE } from './http';
import { filesApi } from './files';
import { getAccessToken } from './session';

/** Fetches the stored bytes of a file. The content endpoint needs the bearer credential, so `<a href>` cannot be used. */
export async function fetchFileBlob(fileId: string): Promise<Blob> {
  const token = await getAccessToken();
  let res: Response;
  try {
    res = await fetch(filesApi.contentPath(fileId), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  } catch {
    throw new ApiClientError({ code: 'NETWORK_ERROR', message: SERVICE_UNAVAILABLE_MESSAGE, status: 0, retryable: true });
  }
  if (!res.ok) {
    let body: unknown;
    try { body = await res.json(); } catch { body = undefined; }
    throw mapErrorBody(body, res.status);
  }
  return res.blob();
}
