/* Pocket Slicer caches only application assets. Models, profiles, and G-code stay local. */
const APP_SCOPE = new URL(self.registration.scope);
const SCOPE_KEY = encodeURIComponent(APP_SCOPE.pathname);
const PREFIX = `pocket-slicer-offline-${SCOPE_KEY}:`;
const META_CACHE = `pocket-slicer-state-v2-${SCOPE_KEY}`;
const META_URL = new URL('__pocket_offline_state__', APP_SCOPE).href;
let preparing = false;

// The private hosting gateway owns sign-in. Never intercept its routes, callbacks,
// redirects, or challenges; only handle the app's known static URL space.
function isAppRequest(url) {
  if (url.origin !== APP_SCOPE.origin || url.search || url.hash || !url.pathname.startsWith(APP_SCOPE.pathname)) return false;
  const path = url.pathname.slice(APP_SCOPE.pathname.length);
  if (['', 'index.html', 'offline-manifest.json', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'].includes(path)) return true;
  return ['assets/', 'engine/', 'licenses/', 'source/'].some(prefix => path.startsWith(prefix));
}

function isAppShell(url) {
  return url.origin === APP_SCOPE.origin && [APP_SCOPE.pathname, new URL('index.html', APP_SCOPE).pathname].includes(url.pathname);
}

async function withIsolationHeaders(response, requestedUrl) {
  if (!isAppRequest(requestedUrl)) return response;
  if (!response.ok || response.redirected || response.type === 'opaque' || response.type === 'opaqueredirect') return response;
  if (response.url && new URL(response.url).origin !== self.location.origin) return response;
  if (response.headers.get('content-type')?.includes('text/html') && !isAppShell(requestedUrl)) return response;
  if (isAppShell(requestedUrl)) {
    if (!response.headers.get('content-type')?.includes('text/html')) return response;
    const html = await response.clone().text();
    // Do not alter a gateway's inline sign-in page, even if it returns HTTP 200 at /.
    if (!/<title>\s*Pocket Slicer(?:\s|·|<)/i.test(html) || !/id=["']root["']/.test(html)) return response;
  }
  const headers = new Headers(response.headers);
  headers.delete('content-encoding');
  headers.delete('content-length');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

async function readState() {
  const response = await (await caches.open(META_CACHE)).match(META_URL);
  const state = response ? await response.json() : null;
  // CacheStorage is origin-wide: never follow metadata into another app's cache.
  return state?.cacheName?.startsWith(PREFIX) ? state : { ready: false, cachedBytes: 0, fileCount: 0 };
}

async function saveOffline(port) {
  if (preparing) throw new Error('An offline download is already running.');
  preparing = true;
  let newCacheName;
  let previous;
  try {
    const manifestResponse = await fetch(new URL('offline-manifest.json', APP_SCOPE).href, { cache: 'no-store' });
    if (!manifestResponse.ok || manifestResponse.redirected) throw new Error('The offline asset list is unavailable. Try again while connected to Wi-Fi.');
    const manifest = await manifestResponse.json();
    if (manifest.app !== 'pocket-slicer' || manifest.format !== 1 || !manifest.version || !Array.isArray(manifest.assets) || !manifest.assets.length) throw new Error('The offline asset list is invalid.');
    if (manifest.basePath !== undefined && manifest.basePath !== APP_SCOPE.pathname) throw new Error('The offline asset list belongs to a different application path.');
    previous = await readState();
    newCacheName = `${PREFIX}${manifest.version}`;
    const cache = await caches.open(newCacheName);
    let completed = 0;
    let bytes = 0;
    const totalBytes = manifest.assets.reduce((total, asset) => total + asset.bytes, 0);
    for (const asset of manifest.assets) {
      const url = new URL(asset.url, APP_SCOPE);
      if (!isAppRequest(url) || !Number.isInteger(asset.bytes) || asset.bytes < 0 || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error('The offline asset list contains an invalid entry.');
      port.postMessage({ type: 'OFFLINE_PROGRESS', progress: { completed, total: manifest.assets.length, bytes, totalBytes, file: asset.url } });
      const response = await fetch(url.href, { cache: 'reload' });
      if (!response.ok || response.redirected || (response.headers.get('content-type')?.includes('text/html') && !asset.document)) {
        throw new Error(`Could not download ${asset.url}. Check your connection and try again.`);
      }
      const body = await response.arrayBuffer();
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', body)), byte => byte.toString(16).padStart(2, '0')).join('');
      if (body.byteLength !== asset.bytes || digest !== asset.sha256) {
        throw new Error('The app changed or a download was incomplete. Reload the page, then save for offline again.');
      }
      // Fetch has already decoded any network compression. Store those exact verified bytes.
      const headers = new Headers(response.headers);
      headers.delete('content-encoding');
      // Every asset is verified against the build manifest, so these bytes do not
      // vary by the Origin header that module-script requests add in browsers.
      headers.delete('vary');
      headers.set('content-length', String(body.byteLength));
      await cache.put(url.href, new Response(body, { status: response.status, statusText: response.statusText, headers }));
      completed += 1;
      bytes += asset.bytes;
      port.postMessage({ type: 'OFFLINE_PROGRESS', progress: { completed, total: manifest.assets.length, bytes, totalBytes, file: asset.url } });
    }
    const state = { ready: true, version: manifest.version, cacheName: newCacheName, cachedBytes: bytes, fileCount: completed, savedAt: new Date().toISOString() };
    await (await caches.open(META_CACHE)).put(META_URL, new Response(JSON.stringify(state), { headers: { 'Content-Type': 'application/json' } }));
    for (const name of await caches.keys()) {
      if (name.startsWith(PREFIX) && name !== newCacheName) await caches.delete(name);
    }
    return state;
  } catch (error) {
    // Keep a previously completed download intact if refreshing it fails.
    if (newCacheName && newCacheName !== previous?.cacheName) await caches.delete(newCacheName);
    if (error?.name === 'QuotaExceededError') throw new Error('There is not enough browser storage for offline slicing. Free some iPhone storage and try again.');
    throw error;
  } finally {
    preparing = false;
  }
}

self.addEventListener('message', (event) => {
  const port = event.ports[0];
  if (!port) return;
  event.waitUntil((async () => {
    try {
      if (event.data?.type === 'GET_ISOLATION_STATUS') port.postMessage({ type: 'ISOLATION_STATUS', supported: true });
      else if (event.data?.type === 'CACHE_OFFLINE') port.postMessage({ type: 'OFFLINE_RESULT', status: await saveOffline(port) });
      else if (event.data?.type === 'GET_OFFLINE_STATUS') {
        const state = await readState();
        const intact = state.ready && await caches.has(state.cacheName) && (await (await caches.open(state.cacheName)).keys()).length === state.fileCount;
        port.postMessage({ type: 'OFFLINE_RESULT', status: intact ? state : { ready: false, cachedBytes: 0, fileCount: 0 } });
      }
    } catch (error) {
      port.postMessage({ type: 'OFFLINE_ERROR', message: error?.message || 'Offline download failed.' });
    }
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !isAppRequest(url)) return;
  event.respondWith((async () => {
    try {
      // Check the network first to avoid mixing an old engine with a newly deployed app.
      return await withIsolationHeaders(await fetch(request), url);
    } catch (error) {
      const state = await readState();
      if (!state.ready) throw error;
      const cache = await caches.open(state.cacheName);
      const cached = await cache.match(request, { ignoreSearch: true, ignoreVary: true });
      if (cached) return withIsolationHeaders(cached, url);
      if (request.mode === 'navigate') {
        const shell = await cache.match(APP_SCOPE.href);
        if (shell) return withIsolationHeaders(shell, url);
      }
      throw error;
    }
  })());
});
