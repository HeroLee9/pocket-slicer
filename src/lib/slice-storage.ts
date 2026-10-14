import type { SliceStatistics } from '../engine';

export type SliceRecovery = { saved: true; id: string; savedAt: number } | { saved: false; reason: string };
export interface SavedSlice {
  version: 1;
  id: string;
  savedAt: number;
  name: string;
  byteLength: number;
  /** Keep this Blob ready for a direct Save tap; no preview is built on recovery. */
  gcode: Blob;
  statistics: SliceStatistics | null;
  elapsedMs: number;
  layerCount: number;
}
type StorageAPI = {
  load(appBase: URL): Promise<SavedSlice | null>;
  remove(id: string, appBase: URL): Promise<void>;
};
let storagePromise: Promise<StorageAPI> | undefined;
const appBase = () => new URL(import.meta.env.BASE_URL, location.href);

function storage(): Promise<StorageAPI> {
  storagePromise ??= import(/* @vite-ignore */ new URL('engine/result-storage.js', appBase()).href)
    .then(() => {
      const api = (globalThis as typeof globalThis & { PocketSliceStorage?: StorageAPI }).PocketSliceStorage;
      if (!api) throw new Error('Local G-code recovery could not start.');
      return api;
    }).catch(error => { storagePromise = undefined; throw error; });
  return storagePromise;
}

/** Reading a completed result never uploads it or starts its optional preview. */
export async function loadSavedSlice(): Promise<SavedSlice | null> {
  return (await storage()).load(appBase());
}

/** Delete only the displayed result, preserving any newer slice from another tab. */
export async function deleteSavedSlice(id: string): Promise<void> {
  await (await storage()).remove(id, appBase());
}
