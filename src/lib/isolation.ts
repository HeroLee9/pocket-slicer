const appBase = new URL(import.meta.env.BASE_URL, location.href);
const serviceWorkerUrl = new URL('sw.js', appBase);
const attemptKey = () => `pocket-slicer-isolation-attempt:${appBase.pathname}`;

/** A visible Retry action can permit one more setup reload. */
export function resetSlicingIsolationAttempt(): void {
  try { sessionStorage.removeItem(attemptKey()); } catch { /* The next attempt explains unavailable storage. */ }
}

function hasIsolationSupport(worker: ServiceWorker): Promise<boolean> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = window.setTimeout(() => { channel.port1.close(); resolve(false); }, 1500);
    channel.port1.onmessage = ({ data }) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(data?.type === 'ISOLATION_STATUS' && data.supported === true);
    };
    worker.postMessage({ type: 'GET_ISOLATION_STATUS' }, [channel.port2]);
  });
}

function waitForControllerChange(): Promise<void> {
  return new Promise(resolve => {
    const done = () => {
      clearTimeout(timer);
      navigator.serviceWorker.removeEventListener('controllerchange', done);
      resolve();
    };
    const timer = window.setTimeout(done, 500);
    navigator.serviceWorker.addEventListener('controllerchange', done, { once: true });
  });
}

/** Run before mounting the interactive app, so its one setup reload cannot lose a model. */
export async function ensureSlicingIsolation(): Promise<'ready' | 'reloading'> {
  if (window.crossOriginIsolated) return 'ready';
  if (!window.isSecureContext) {
    throw new Error('Open Pocket Slicer using its HTTPS link in Safari. Local slicing cannot start from an unsecured address.');
  }
  if (!('serviceWorker' in navigator)) {
    throw new Error('This browser cannot prepare local slicing. Open the link in a regular Safari tab.');
  }
  try {
    if (sessionStorage.getItem(attemptKey())) {
      throw new Error('Local slicing could not start after setup. Open the link directly in a regular Safari tab, then tap Retry.');
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Local slicing')) throw error;
    throw new Error('Your browser could not save the app’s setup. Open the link in a regular Safari tab and try again.');
  }

  const prepare = async () => {
    const registration = await navigator.serviceWorker.register(serviceWorkerUrl.href, { scope: appBase.pathname, updateViaCache: 'none' });
    await registration.update();
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const controller = navigator.serviceWorker.controller;
      if (controller?.scriptURL === serviceWorkerUrl.href && await hasIsolationSupport(controller)) return;
      await waitForControllerChange();
    }
    throw new Error('The app is still preparing local slicing. Keep this tab open and tap Retry.');
  };
  let timeout: number | undefined;
  try {
    await Promise.race([
      prepare(),
      new Promise<never>((_, reject) => {
        timeout = window.setTimeout(() => reject(new Error('Setup could not finish. Check your connection, then tap Retry.')), 20_000);
      }),
    ]);
    sessionStorage.setItem(attemptKey(), '1');
    if (sessionStorage.getItem(attemptKey()) !== '1') throw new Error('Setup storage is unavailable.');
  } catch (error) {
    if (error instanceof Error && /Retry|setup|Setup/.test(error.message)) throw error;
    throw new Error('The app could not prepare local slicing. Check your connection and open the link in a regular Safari tab, then tap Retry.');
  } finally {
    window.clearTimeout(timeout);
  }
  location.reload();
  return 'reloading';
}
