export interface OfflineStatus {
  supported: boolean;
  ready: boolean;
  cachedBytes: number;
  fileCount: number;
  version?: string;
  savedAt?: string;
  reason?: string;
}

export interface OfflineProgress {
  completed: number;
  total: number;
  bytes: number;
  totalBytes: number;
  file: string;
}

let registrationPromise: Promise<ServiceWorkerRegistration> | undefined;
const appBase = new URL(import.meta.env.BASE_URL, location.href);
const serviceWorkerUrl = new URL('sw.js', appBase);

function register(): Promise<ServiceWorkerRegistration> {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    return Promise.reject(new Error('Offline slicing needs Safari on an HTTPS address.'));
  }
  registrationPromise ??= navigator.serviceWorker.register(serviceWorkerUrl.href, { scope: appBase.pathname })
    .then(async (registration) => {
      // A broader worker on the same host must not answer this app's offline requests.
      if (registration.active) return registration;
      const worker = registration.installing ?? registration.waiting;
      if (!worker) throw new Error('Offline storage is still starting. Try again in a moment.');
      await new Promise<void>((resolve, reject) => {
        const finish = (error?: Error) => {
          clearTimeout(timer);
          worker.removeEventListener('statechange', check);
          if (error) reject(error); else resolve();
        };
        const check = () => {
          if (worker.state === 'activated') finish();
          else if (worker.state === 'redundant') finish(new Error('Offline storage setup was interrupted. Try again.'));
        };
        const timer = window.setTimeout(() => finish(new Error('Offline storage is still starting. Try again in a moment.')), 15_000);
        worker.addEventListener('statechange', check);
        check();
      });
      return registration;
    })
    .catch((error) => { registrationPromise = undefined; throw error; });
  return registrationPromise;
}

async function send(type: string, onProgress?: (progress: OfflineProgress) => void): Promise<OfflineStatus> {
  const registration = await register();
  const worker = registration.active;
  if (!worker) throw new Error('Offline storage is still starting. Try again in a moment.');
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => {
      channel.port1.close();
      reject(new Error('Offline storage did not respond. Keep Safari open and try again.'));
    }, type === 'CACHE_OFFLINE' ? 600_000 : 10_000);
    channel.port1.onmessage = (event) => {
      if (event.data.type === 'OFFLINE_PROGRESS') { onProgress?.(event.data.progress); return; }
      clearTimeout(timeout);
      channel.port1.close();
      if (event.data.type === 'OFFLINE_ERROR') reject(new Error(event.data.message));
      else resolve({ supported: true, ...event.data.status });
    };
    worker.postMessage({ type }, [channel.port2]);
  });
}

export async function getOfflineStatus(): Promise<OfflineStatus> {
  try { return await send('GET_OFFLINE_STATUS'); }
  catch (error) {
    return { supported: false, ready: false, cachedBytes: 0, fileCount: 0, reason: error instanceof Error ? error.message : 'Offline storage is unavailable.' };
  }
}

/** Call from an explicit “Save for offline” action. Includes the engine and bundled profiles. */
export async function cacheForOffline(onProgress?: (progress: OfflineProgress) => void): Promise<OfflineStatus> {
  // Persistence is a best-effort request. Safari can still evict website storage.
  void navigator.storage?.persist?.().catch(() => false);
  return send('CACHE_OFFLINE', onProgress);
}
