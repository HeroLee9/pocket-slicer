/** Browser bridge to the pinned, local OrcaSlicer WebAssembly engine. */
import type { SliceRecovery } from '../lib/slice-storage';

export interface EngineProgress {
  stage: string;
  percent: number | null;
}

export interface EngineInfo {
  name: string;
  version: string;
  release: string;
  apiVersion: string;
  capabilities: Record<string, unknown>;
}

export interface SliceStatistics {
  timeSeconds?: { normal: number | null; silent?: number | null; firstLayer?: number | null };
  filament?: { totalLengthMm: number; totalVolumeCm3: number; totalMassG: number; totalCost: number };
  [key: string]: unknown;
}

export interface SliceInput {
  /** STL coordinates in millimetres, Z up. Rotation and scaling may already be baked in. */
  stl: ArrayBuffer;
  name: string;
  /** Fully resolved native Orca settings, including printer start/end G-code. */
  config: Record<string, unknown>;
  /** Optional row-major 4x4 transform. By default, center on the bed and ground Z. */
  transform?: number[];
}

export interface SliceResult {
  gcode: Uint8Array;
  name: string;
  statistics: SliceStatistics | null;
  elapsedMs: number;
  layerCount: number;
  recovery?: SliceRecovery;
}

interface RequestOptions {
  onProgress?: (progress: EngineProgress) => void;
  signal?: AbortSignal;
  /** Transfer a temporary STL buffer directly. The caller's buffer becomes detached. */
  transferInput?: boolean;
}

interface Pending {
  type: string;
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  onProgress?: RequestOptions['onProgress'];
  cleanup: () => void;
}

export class SlicerError extends Error {
  code: string;
  constructor(message: string, code = 'ENGINE') {
    super(message);
    this.name = 'SlicerError';
    this.code = code;
  }
}

export class OrcaSlicerClient {
  private worker: Worker | null = null;
  private pending = new Map<number, Pending>();
  private sequence = 0;
  private engineBaseUrl: URL;
  private disposed = false;

  constructor(options: { engineBaseUrl?: string } = {}) {
    this.engineBaseUrl = new URL(options.engineBaseUrl ?? `${import.meta.env.BASE_URL}engine/`, document.baseURI);
  }

  initialize(onProgress?: (progress: EngineProgress) => void): Promise<EngineInfo> {
    return this.request<EngineInfo>('initialize', {}, { onProgress });
  }

  slice(input: SliceInput, options: RequestOptions = {}): Promise<SliceResult> {
    if (options.signal?.aborted) return Promise.reject(new SlicerError('Slicing cancelled.', 'CANCELLED'));
    // A freshly generated plate STL can transfer directly without another mesh
    // allocation. Preserve caller-owned meshes unless explicitly opted in.
    const stl = options.transferInput ? input.stl : input.stl.slice(0);
    return this.request<SliceResult>('slice', { ...input, stl }, options, [stl]);
  }

  cancel(): void {
    this.worker?.postMessage({ type: 'cancel' });
  }

  dispose(): void {
    this.disposed = true;
    if (this.worker) this.releaseWorker(this.worker);
    this.failAll(new SlicerError('Slicer was closed.', 'CANCELLED'));
  }

  private getWorker(): Worker {
    if (this.disposed) throw new SlicerError('Slicer was closed. Reload to start again.', 'CLOSED');
    if (!globalThis.isSecureContext) {
      throw new SlicerError('Local slicing needs HTTPS (or localhost for development). Open the secure app address.', 'INSECURE_CONTEXT');
    }
    if (!globalThis.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
      throw new SlicerError('This page cannot start the slicer. The server must send Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp.', 'ISOLATION_REQUIRED');
    }
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('pocket-worker.js', this.engineBaseUrl), { name: 'pocket-slicer' });
    worker.onmessage = ({ data }) => {
      const pending = this.pending.get(data.id);
      if (!pending) return;
      if (data.type === 'progress') {
        pending.onProgress?.(data.progress);
        return;
      }
      this.pending.delete(data.id);
      pending.cleanup();
      // The result buffer has already transferred into this realm. Drop the
      // complete WASM runtime before the caller stores/renders that result.
      // Session.dispose() alone keeps the grown shared heap and pthread pool.
      if (pending.type === 'slice' || data.retired) this.releaseWorker(worker);
      if (data.type === 'result') pending.resolve(data.result);
      else pending.reject(new SlicerError(data.error?.message ?? 'Slicing failed.', data.error?.code));
    };
    worker.onerror = (event) => {
      event.preventDefault();
      this.failAll(new SlicerError(event.message || 'The slicing worker stopped. Try a smaller model or reload the app.', 'WORKER_FAILED'));
      this.releaseWorker(worker);
    };
    worker.onmessageerror = () => {
      this.failAll(new SlicerError('The slicing worker returned unreadable data.', 'WORKER_FAILED'));
      this.releaseWorker(worker);
    };
    this.worker = worker;
    return worker;
  }

  private request<T>(type: string, payload: unknown, options: RequestOptions = {}, transfer: Transferable[] = []): Promise<T> {
    if (options.signal?.aborted) return Promise.reject(new SlicerError('Slicing cancelled.', 'CANCELLED'));
    if (this.pending.size) return Promise.reject(new SlicerError('The slicer is already working. Wait for it to finish or cancel.', 'BUSY'));
    return new Promise((resolve, reject) => {
      let worker: Worker;
      try { worker = this.getWorker(); } catch (error) { reject(error); return; }
      const id = ++this.sequence;
      const abort = () => worker.postMessage({ type: 'cancel', id });
      const cleanup = () => options.signal?.removeEventListener('abort', abort);
      options.signal?.addEventListener('abort', abort, { once: true });
      this.pending.set(id, { type, resolve, reject, onProgress: options.onProgress, cleanup });
      try { worker.postMessage({ type, id, payload }, transfer); }
      catch (error) {
        this.pending.delete(id);
        cleanup();
        this.releaseWorker(worker);
        reject(error);
      }
    });
  }

  private releaseWorker(worker: Worker): void {
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
    if (this.worker === worker) this.worker = null;
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.cleanup();
      pending.reject(error);
    }
    this.pending.clear();
  }
}
