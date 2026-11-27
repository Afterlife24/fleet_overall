import type { DocType, SignedFileRef } from '../types/collection';
import { validateSignedFile } from './collectionCore';
import { useCollectionStore } from '../store/collectionStore';
import { useMqdStore } from '../store/mqdStore';
import { useThirdPartyStore } from '../store/thirdPartyStore';

export interface SignedFilesApi {
  put(key: string, file: Blob, meta: { name: string; mime: string }): Promise<SignedFileRef>;
  get(key: string): Promise<{ blob: Blob; ref: SignedFileRef } | undefined>;
  remove(key: string): Promise<void>;
  readonly backend: 'indexeddb' | 'memory';
}

const DB_NAME = 'axleops-signed-files';
const STORE = 'files';

interface StoredRow {
  key: string;
  blob: Blob;
  name: string;
  mime: string;
  size: number;
  uploadedAt: string;
}

function toRef(row: StoredRow): SignedFileRef {
  return { key: row.key, name: row.name, mime: row.mime, size: row.size, uploadedAt: row.uploadedAt };
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function openDb(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let r: IDBOpenDBRequest;
    try {
      r = idb.open(DB_NAME, 1);
    } catch (err) {
      reject(err);
      return;
    }
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE)) {
        r.result.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB open failed'));
    r.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
}

export function createSignedFiles(idb?: IDBFactory | null): SignedFilesApi {
  const factory: IDBFactory | null =
    idb === undefined ? (typeof indexedDB !== 'undefined' ? indexedDB : null) : idb;
  const memory = new Map<string, StoredRow>();
  let dbPromise: Promise<IDBDatabase | null> | null = null;
  let backend: 'indexeddb' | 'memory' = factory ? 'indexeddb' : 'memory';

  const getDb = (): Promise<IDBDatabase | null> => {
    if (!factory) return Promise.resolve(null);
    if (!dbPromise) {
      dbPromise = openDb(factory).catch((err) => {
        console.warn('[signedFiles] IndexedDB unavailable, using in-memory storage', err);
        backend = 'memory';
        return null;
      });
    }
    return dbPromise;
  };

  return {
    get backend() {
      return backend;
    },
    async put(key, file, meta) {
      const row: StoredRow = {
        key,
        blob: file,
        name: meta.name,
        mime: meta.mime,
        size: file.size,
        uploadedAt: new Date().toISOString(),
      };
      const db = await getDb();
      if (!db) {
        memory.set(key, row);
        return toRef(row);
      }
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(row);
      await txDone(tx);
      return toRef(row);
    },
    async get(key) {
      const db = await getDb();
      if (!db) {
        const row = memory.get(key);
        return row ? { blob: row.blob, ref: toRef(row) } : undefined;
      }
      const row = (await req(db.transaction(STORE, 'readonly').objectStore(STORE).get(key))) as
        | StoredRow
        | undefined;
      return row ? { blob: row.blob, ref: toRef(row) } : undefined;
    },
    async remove(key) {
      const db = await getDb();
      if (!db) {
        memory.delete(key);
        return;
      }
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      await txDone(tx);
    },
  };
}

export const signedFiles: SignedFilesApi = createSignedFiles();

function findDoc(type: DocType, id: string): { orgId: string } | undefined {
  if (type === 'CN') return useCollectionStore.getState().getById(id);
  if (type === 'MQD') return useMqdStore.getState().getById(id);
  return useThirdPartyStore.getState().getById(id);
}

function patchDoc(type: DocType, id: string, data: { signedStatus: 'Signed'; signedFile: SignedFileRef }): void {
  if (type === 'CN') useCollectionStore.getState().patch(id, data);
  else if (type === 'MQD') useMqdStore.getState().patch(id, data);
  else useThirdPartyStore.getState().patch(id, data);
}

/** Validates, stores the signed copy, then marks the owning document Signed. */
export async function attachSigned(
  type: DocType,
  id: string,
  file: Blob & { name: string; type: string },
): Promise<SignedFileRef> {
  const v = validateSignedFile({ type: file.type, name: file.name });
  if (!v.ok) throw new Error(v.message);
  const doc = findDoc(type, id);
  if (!doc) throw new Error('Document not found');
  const ref = await signedFiles.put(`${doc.orgId}/${type}/${id}`, file, { name: file.name, mime: file.type });
  patchDoc(type, id, { signedStatus: 'Signed', signedFile: ref });
  return ref;
}

/** Returns the stored signed copy blob for viewing, or undefined. */
export async function getSignedFile(type: DocType, id: string): Promise<Blob | undefined> {
  const doc = findDoc(type, id);
  if (!doc) return undefined;
  return (await signedFiles.get(`${doc.orgId}/${type}/${id}`))?.blob;
}