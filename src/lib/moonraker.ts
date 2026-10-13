import { createGcodeFile, type GcodeContent } from './export';

export interface MoonrakerConnection {
  /** Moonraker or its reverse proxy, e.g. http://192.168.0.42:7125. */
  url: string;
  apiKey?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface MoonrakerInfo {
  klippy_connected: boolean;
  klippy_state: string;
  moonraker_version: string;
  components?: string[];
  registered_directories?: string[];
}

export interface MoonrakerUploadResult {
  item: { path: string; root: string; size: number; modified?: number };
  print_started: boolean;
  print_queued?: boolean;
  action: string;
}

export class MoonrakerError extends Error {
  constructor(message: string, public readonly code: 'address' | 'network' | 'timeout' | 'auth' | 'response', public readonly status?: number) {
    super(message);
    this.name = 'MoonrakerError';
  }
}

/** Scheme-less hostnames are treated as local HTTP; explicit ports are preserved. */
export function normalizeMoonrakerUrl(input: string): string {
  const value = input.trim();
  if (!value) throw new MoonrakerError('Enter your printer’s Moonraker address, including its port (usually 7125).', 'address');
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `http://${value}`);
  } catch {
    throw new MoonrakerError('Enter a valid Moonraker address, such as http://192.168.0.42:7125.', 'address');
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) {
    throw new MoonrakerError('Use an HTTP or HTTPS printer address without credentials, query parameters, or a page fragment.', 'address');
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

export function moonrakerConnectionHint(input: string): string | null {
  let url: URL;
  try { url = new URL(normalizeMoonrakerUrl(input)); } catch { return null; }
  if (typeof location !== 'undefined' && location.protocol === 'https:' && url.protocol === 'http:') {
    return 'Safari may block this HTTPS app from reaching an HTTP printer. You can always save the G-code to Files, then open Fluidd or Mainsail in a separate tab and upload it there.';
  }
  return null;
}

async function request<T>(connection: MoonrakerConnection, path: string, init: RequestInit = {}): Promise<T> {
  const base = normalizeMoonrakerUrl(connection.url);
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort(connection.signal?.reason);
  if (connection.signal?.aborted) onAbort();
  else connection.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, connection.timeoutMs ?? 15_000);
  const headers = new Headers(init.headers);
  if (connection.apiKey?.trim()) headers.set('X-Api-Key', connection.apiKey.trim());
  headers.set('Accept', 'application/json');
  try {
    const response = await fetch(`${base}${path}`, {
      ...init, headers, signal: controller.signal, mode: 'cors', credentials: 'omit', cache: 'no-store',
    });
    if (response.status === 401 || response.status === 403) {
      throw new MoonrakerError('Moonraker denied access. Check its API key and allowed origins.', 'auth', response.status);
    }
    if (!response.ok) {
      throw new MoonrakerError(`Moonraker returned HTTP ${response.status}. Check the printer address and Moonraker status.`, 'response', response.status);
    }
    let data: unknown;
    try { data = await response.json(); } catch {
      throw new MoonrakerError('This address did not return Moonraker JSON. Use its API address (usually port 7125), or a configured Moonraker proxy.', 'response', response.status);
    }
    if (!data || typeof data !== 'object') throw new MoonrakerError('Moonraker returned an unexpected response.', 'response');
    if ('error' in data) throw new MoonrakerError('Moonraker could not complete the request. Check its status in Fluidd or Mainsail.', 'response');
    return ('result' in data ? data.result : data) as T;
  } catch (error) {
    if (error instanceof MoonrakerError) throw error;
    if (timedOut) throw new MoonrakerError('The printer did not respond in time. Check its address and that your phone is on the same Wi-Fi.', 'timeout');
    if (connection.signal?.aborted) throw error;
    throw new MoonrakerError(moonrakerConnectionHint(base) ?? 'Could not reach Moonraker. Check the address, Wi-Fi, local-network permission, and Moonraker cors_domains for this app’s origin.', 'network');
  } finally {
    clearTimeout(timer);
    connection.signal?.removeEventListener('abort', onAbort);
  }
}

/** Read-only connection test. No printer movement, heating, or configuration changes. */
export async function getMoonrakerInfo(connection: MoonrakerConnection): Promise<MoonrakerInfo> {
  const info = await request<MoonrakerInfo>(connection, '/server/info');
  if (typeof info.klippy_connected !== 'boolean' || typeof info.klippy_state !== 'string') {
    throw new MoonrakerError('This address did not return valid Moonraker server information.', 'response');
  }
  return info;
}

/** Upload only. The API deliberately provides no way to start or queue a print. */
export async function uploadGcode(connection: MoonrakerConnection, content: GcodeContent, name: string): Promise<MoonrakerUploadResult> {
  const file = createGcodeFile(content, name);
  if (!file.size) throw new MoonrakerError('There is no G-code to upload. Slice a model first.', 'response');
  const form = new FormData();
  form.append('root', 'gcodes');
  form.append('print', 'false');
  form.append('file', file, file.name);
  const result = await request<MoonrakerUploadResult>({ ...connection, timeoutMs: connection.timeoutMs ?? 120_000 }, '/server/files/upload', {
    method: 'POST', body: form,
  });
  if (!result.item || result.item.root !== 'gcodes' || typeof result.item.path !== 'string') {
    throw new MoonrakerError('The upload response could not be verified. Check Fluidd or Mainsail before uploading again.', 'response');
  }
  if (result.print_started || result.print_queued) {
    throw new MoonrakerError('Moonraker unexpectedly reported that this upload started or queued a print. Check the printer in Fluidd or Mainsail immediately.', 'response');
  }
  return result;
}
