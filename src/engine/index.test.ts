import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrcaSlicerClient, type SliceInput } from './index';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  messages: any[] = [];
  terminated = false;
  constructor() { FakeWorker.instances.push(this); }
  postMessage(message: unknown, transfer: Transferable[] = []) {
    this.messages.push(structuredClone(message, { transfer }));
  }
  terminate() { this.terminated = true; }
  respond(data: unknown) { this.onmessage?.({ data }); }
}
const input = (): SliceInput => ({ stl: new Uint8Array([1, 2, 3]).buffer, name: 'part.stl', config: {} });
const result = () => ({ gcode: new Uint8Array([71, 49]), name: 'part.gcode', statistics: null, elapsedMs: 10, layerCount: 1 });

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal('document', { baseURI: 'https://example.test/app/' });
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('crossOriginIsolated', true);
  vi.stubGlobal('Worker', FakeWorker);
});
afterEach(() => vi.unstubAllGlobals());

describe('slicer runtime lifetime', () => {
  it('releases the worker before delivering G-code and starts a new runtime for another slice', async () => {
    const client = new OrcaSlicerClient({ engineBaseUrl: './engine/' });
    const initialization = client.initialize();
    const first = FakeWorker.instances[0];
    first.respond({ id: 1, type: 'result', result: { name: 'OrcaSlicer' } });
    await initialization;
    expect(first.terminated).toBe(false);
    const operation = client.slice(input());
    const output = result();
    let wasReleased = false;
    const checked = operation.then(value => { wasReleased = first.terminated; return value; });
    first.respond({ id: 2, type: 'result', result: output });
    await expect(checked).resolves.toBe(output);
    expect(wasReleased).toBe(true);
    const repeated = client.slice(input());
    const second = FakeWorker.instances[1];
    expect(second).toBeDefined();
    second.respond({ id: 3, type: 'result', result: result() });
    await repeated;
    expect(second.terminated).toBe(true);
    client.dispose();
  });

  it.each(['ENGINE', 'CANCELLED'])('releases a runtime after %s and permits retry', async code => {
    const client = new OrcaSlicerClient();
    const operation = client.slice(input());
    const rejection = expect(operation).rejects.toMatchObject({ code });
    FakeWorker.instances[0].respond({ id: 1, type: 'error', error: { code, message: 'Stopped' } });
    await rejection;
    expect(FakeWorker.instances[0].terminated).toBe(true);
    const retry = client.slice(input());
    FakeWorker.instances[1].respond({ id: 2, type: 'result', result: result() });
    await retry;
    client.dispose();
  });

  it('rejects overlapping requests without terminating the current slice', async () => {
    const client = new OrcaSlicerClient();
    const operation = client.slice(input());
    await expect(client.slice(input())).rejects.toMatchObject({ code: 'BUSY' });
    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0].terminated).toBe(false);
    FakeWorker.instances[0].respond({ id: 1, type: 'result', result: result() });
    await operation;
    client.dispose();
  });

  it('transfers a temporary mesh directly but preserves caller-owned input by default', async () => {
    const client = new OrcaSlicerClient();
    const temporary = input();
    const first = client.slice(temporary, { transferInput: true });
    expect(temporary.stl.byteLength).toBe(0);
    expect(new Uint8Array(FakeWorker.instances[0].messages[0].payload.stl)).toEqual(new Uint8Array([1, 2, 3]));
    FakeWorker.instances[0].respond({ id: 1, type: 'result', result: result() });
    await first;
    const retained = input();
    const second = client.slice(retained);
    expect(retained.stl.byteLength).toBe(3);
    FakeWorker.instances[1].respond({ id: 2, type: 'result', result: result() });
    await second;
    client.dispose();
  });
});
