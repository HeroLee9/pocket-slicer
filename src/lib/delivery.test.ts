import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGcodeFile, exportGcode, MAX_NATIVE_GCODE_BYTES } from './export';
import { getMoonrakerInfo, normalizeMoonrakerUrl, uploadGcode } from './moonraker';

afterEach(() => vi.unstubAllGlobals());

describe('local G-code export', () => {
  it('preserves G-code bytes and a real gcode extension', async () => {
    const source = '; local slice\nG1 X12.5 Y20 E0.23\n';
    const file = createGcodeFile(source, '../part.stl');
    expect(file.name).toBe('part.gcode');
    expect(await file.text()).toBe(source);
  });

  it('does not silently download a second file when an iPhone share is cancelled', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
    vi.stubGlobal('navigator', { canShare: () => true, share });
    const result = await exportGcode('G1 X1\n', 'part');
    expect(result.method).toBe('cancelled');
    expect(share).toHaveBeenCalledOnce();
  });
});

describe('installed iPhone Files export', () => {
  function installBridge(postMessage: ReturnType<typeof vi.fn>) {
    vi.stubGlobal('window', { webkit: { messageHandlers: { nativeSaveGcode: { postMessage } } } });
    const share = vi.fn();
    vi.stubGlobal('navigator', { canShare: () => true, share });
    return share;
  }

  it('preserves a multi-chunk Unicode file and waits for Files to confirm its save', async () => {
    let confirmSave!: (value: { status: string }) => void;
    const reply = new Promise(resolve => { confirmSave = resolve; });
    const bridge = vi.fn().mockReturnValue(reply);
    const share = installBridge(bridge);
    const source = '; 模型 🐋\n' + 'G1 X12.5 Y20 E0.23\n'.repeat(6000);
    const operation = exportGcode(source, '模型🧩'.repeat(100) + '.stl');
    let finished = false;
    void operation.then(() => { finished = true; });
    await vi.waitFor(() => expect(bridge).toHaveBeenCalledOnce());
    const payload = bridge.mock.calls[0][0];
    expect(payload.version).toBe(1);
    expect(new TextDecoder().decode(Uint8Array.from(atob(payload.base64), character => character.charCodeAt(0)))).toBe(source);
    expect(payload.byteLength).toBe(new TextEncoder().encode(source).length);
    expect(new TextEncoder().encode(payload.filename).length).toBeLessThanOrEqual(200);
    expect(payload.filename).toMatch(/\.gcode$/);
    expect(finished).toBe(false);
    confirmSave({ status: 'saved' });
    await expect(operation).resolves.toEqual({ method: 'native', filename: payload.filename });
    expect(share).not.toHaveBeenCalled();
  });

  it('never falls back to browser sharing after native cancellation or failure', async () => {
    const bridge = vi.fn().mockResolvedValueOnce({ status: 'cancelled' }).mockRejectedValueOnce(new Error('Drive disconnected'));
    const share = installBridge(bridge);
    await expect(exportGcode('G1 X1\n', 'part')).resolves.toEqual({ method: 'cancelled', filename: 'part.gcode' });
    await expect(exportGcode('G1 X1\n', 'part')).rejects.toThrow('Drive disconnected');
    expect(share).not.toHaveBeenCalled();
  });

  it('rejects oversized output before allocating a bridge payload', async () => {
    const bridge = vi.fn();
    installBridge(bridge);
    const output = new Blob([new Uint8Array(MAX_NATIVE_GCODE_BYTES + 1)]);
    await expect(exportGcode(output, 'large')).rejects.toThrow('64 MB');
    expect(bridge).not.toHaveBeenCalled();
  });
});

describe('Moonraker protocol', () => {
  it('reads server status and preserves a reverse proxy base path', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ result: { klippy_connected: true, klippy_state: 'ready', moonraker_version: 'v0.9' } }));
    vi.stubGlobal('fetch', fetcher);
    expect(normalizeMoonrakerUrl('192.168.0.42:7125/')).toBe('http://192.168.0.42:7125');
    const info = await getMoonrakerInfo({ url: 'https://printer.test/moonraker/' });
    expect(info.klippy_state).toBe('ready');
    expect(fetcher.mock.calls[0][0]).toBe('https://printer.test/moonraker/server/info');
  });

  it('uploads a complete file with printing explicitly disabled', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ item: { root: 'gcodes', path: 'part.gcode', size: 6 }, print_started: false, print_queued: false, action: 'create_file' }));
    vi.stubGlobal('fetch', fetcher);
    await uploadGcode({ url: 'http://printer.test:7125' }, 'G1 X1\n', 'part.stl');
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('http://printer.test:7125/server/files/upload');
    expect(init.method).toBe('POST');
    const form = init.body as FormData;
    expect(form.get('print')).toBe('false');
    expect(form.get('root')).toBe('gcodes');
    expect((form.get('file') as File).name).toBe('part.gcode');
    expect(await (form.get('file') as File).text()).toBe('G1 X1\n');
  });

  it('does not report upload-only success if the printer reports starting a print', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ item: { root: 'gcodes', path: 'part.gcode', size: 6 }, print_started: true, action: 'create_file' })));
    await expect(uploadGcode({ url: 'http://printer.test:7125' }, 'G1 X1\n', 'part')).rejects.toThrow('unexpectedly reported');
  });

  it('surfaces authentication failures without copying API credentials into errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    await expect(getMoonrakerInfo({ url: 'http://printer.test:7125', apiKey: 'example-test-key' })).rejects.toThrow('Moonraker denied access');
  });
});
