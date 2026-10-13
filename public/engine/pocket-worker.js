/* Pocket Slicer adapter. Engine artifacts remain unmodified upstream releases. */
'use strict';
importScripts(new URL('gcode-validation.js', self.location.href).href);
const API_VERSION = '0.7.0';
const RELEASE = 'wasm-v2.4.2-patch29-multithreaded';
const engineUrl = new URL('slicer-mt.js', self.location.href).href;
// Split only for static hosts' per-file limits; concatenation recreates the
// byte-identical upstream WASM (SHA-256 recorded in PROVENANCE.json).
const wasmParts = ['slicer-mt.wasm.part0', 'slicer-mt.wasm.part1'];
const wasmLength = 29019444;
let enginePromise = null;
let active = null;
const loadingListeners = new Set();

function progress(id, stage, percent = null) {
  self.postMessage({ type: 'progress', id, progress: { stage, percent } });
}

function notifyLoading(stage, percent = null) {
  for (const id of loadingListeners) progress(id, stage, percent);
}

async function loadEngine(id) {
  loadingListeners.add(id);
  try {
    if (!enginePromise) enginePromise = (async () => {
      if (!self.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
        throw Object.assign(new Error('Cross-origin isolation is required for local slicing.'), { code: 'ISOLATION_REQUIRED' });
      }
      notifyLoading('Loading local slicing engine', 0);
      const wasmBinary = new Uint8Array(wasmLength);
      let loaded = 0;
      for (const part of wasmParts) {
        const response = await fetch(new URL(part, self.location.href));
        if (!response.ok) throw new Error(`Could not load engine (${response.status}). Reconnect once to install it.`);
        if (response.body) {
          const reader = response.body.getReader();
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (loaded + value.byteLength > wasmLength) throw new Error('Engine download is invalid. Reinstall the offline engine.');
            wasmBinary.set(value, loaded);
            loaded += value.byteLength;
            notifyLoading('Loading local slicing engine', Math.min(95, loaded / wasmLength * 95));
          }
        } else {
          const bytes = new Uint8Array(await response.arrayBuffer());
          wasmBinary.set(bytes, loaded);
          loaded += bytes.byteLength;
        }
      }
      if (loaded !== wasmLength) throw new Error('Engine download is incomplete. Reconnect once and retry.');
      notifyLoading('Starting OrcaSlicer', 96);
      importScripts(engineUrl);
      if (OneSlicerEngine.apiVersion !== API_VERSION) throw new Error('Engine API version does not match this app. Reload after updating.');
      const engine = await OneSlicerEngine.createEngine({ runtime: {
        wasmBinary,
        mainScriptUrlOrBlob: engineUrl,
        locateFile: (name) => new URL(name, self.location.href).href,
        print: () => {},
        printErr: (line) => console.warn('[OrcaSlicer]', line),
      } });
      const required = ['core.session', 'core.configuration', 'project.manifest', 'project.slice', 'project.slice.assets', 'runtime.progress', 'runtime.capabilities', 'runtime.errors'];
      for (const feature of required) {
        if (engine.capabilities.features?.[feature] !== 'supported') throw new Error(`Engine is missing ${feature}.`);
      }
      notifyLoading('OrcaSlicer ready', 100);
      return engine;
    })().catch((error) => { enginePromise = null; throw error; });
    return await enginePromise;
  } finally { loadingListeners.delete(id); }
}

function boundsOfStl(bytes) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let vertices = 0;
  const add = (x, y, z) => {
    const values = [x, y, z];
    if (!values.every(Number.isFinite)) throw new Error('The STL contains invalid coordinates.');
    values.forEach((v, i) => { min[i] = Math.min(min[i], v); max[i] = Math.max(max[i], v); });
    vertices++;
  };
  if (bytes.byteLength >= 84) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const triangles = view.getUint32(80, true);
    if (triangles > 0 && 84 + triangles * 50 === bytes.byteLength) {
      for (let triangle = 0; triangle < triangles; triangle++) {
        for (let vertex = 0; vertex < 3; vertex++) {
          const offset = 84 + triangle * 50 + 12 + vertex * 12;
          add(view.getFloat32(offset, true), view.getFloat32(offset + 4, true), view.getFloat32(offset + 8, true));
        }
      }
      return { min, max };
    }
  }
  const text = new TextDecoder().decode(bytes);
  const matches = text.matchAll(/\bvertex\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)/gi);
  for (const match of matches) add(Number(match[1]), Number(match[2]), Number(match[3]));
  if (vertices < 3 || vertices % 3) throw new Error('This file is not a readable STL mesh.');
  return { min, max };
}

function makeManifest(bytes, input) {
  const bounds = boundsOfStl(bytes);
  const bedX = Number(input.config.bed_size_x ?? 220);
  const bedY = Number(input.config.bed_size_y ?? 220);
  const bedZ = Number(input.config.printable_height ?? 250);
  if (![bedX, bedY, bedZ].every((value) => Number.isFinite(value) && value > 0)) throw new Error('Printer build volume is invalid.');
  if (!input.transform) {
    const size = bounds.max.map((value, axis) => value - bounds.min[axis]);
    if (size.some((value, axis) => value > [bedX, bedY, bedZ][axis] + 0.01)) {
      throw Object.assign(new Error(`Model is too large for the ${bedX} × ${bedY} × ${bedZ} mm build volume. Scale or rotate it first.`), { code: 'VALIDATION' });
    }
  }
  const matrix = input.transform ?? [
    1, 0, 0, bedX / 2 - (bounds.min[0] + bounds.max[0]) / 2,
    0, 1, 0, bedY / 2 - (bounds.min[1] + bounds.max[1]) / 2,
    0, 0, 1, -bounds.min[2],
    0, 0, 0, 1,
  ];
  return {
    schemaVersion: API_VERSION,
    plates: [{ id: 'plate-0', label: 'K1C build plate', index: 0 }],
    meshes: [{ id: 'mesh-0', format: 'stl', dataRange: { offset: 0, length: bytes.length } }],
    objects: [{ id: 'object-0', meshId: 'mesh-0' }],
    instances: [{ id: 'instance-0', objectId: 'object-0', plateId: 'plate-0', transform: { matrix } }],
    modifierVolumes: [],
  };
}

async function slice(id, input) {
  if (active) throw Object.assign(new Error('A model is already being sliced.'), { code: 'BUSY' });
  const operation = { id, controller: new AbortController() };
  active = operation;
  const started = performance.now();
  let session;
  try {
    const engine = await loadEngine(id);
    if (operation.controller.signal.aborted) throw Object.assign(new Error('Slicing cancelled.'), { code: 'CANCELLED' });
    progress(id, 'Preparing model', 0);
    const bytes = new Uint8Array(input.stl);
    const manifest = makeManifest(bytes, input);
    session = await engine.createSession();
    await session.init(new TextEncoder().encode(JSON.stringify(input.config)));
    await session.setObjects(bytes, manifest);
    const result = await session.slice({
      schemaVersion: API_VERSION,
      plateSelection: 'selected',
      plateIds: ['plate-0'],
      includeGcode: true,
      includeStatistics: true,
    }, {
      signal: operation.controller.signal,
      onProgress: (event) => progress(id, event.stage || 'Slicing model', event.percent),
    });
    const plate = result.plateResults?.[0];
    const asset = plate?.assets.find((entry) => entry.kind === 'gcode');
    if (!asset) throw new Error('OrcaSlicer did not produce G-code.');
    const gcode = await session.getAsset(asset.id);
    if (gcode.byteLength !== asset.byteLength || !gcode.byteLength) throw new Error('OrcaSlicer returned incomplete G-code.');
    const text = new TextDecoder().decode(gcode);
    if (!/^G[01]\s.*\bE[-\d.]+/m.test(text)) throw new Error('The sliced file contains no extrusion moves. Check the model dimensions.');
    progress(id, 'Checking print boundaries', 99);
    validateGcodeEnvelope(text, { x: Number(input.config.bed_size_x ?? 220), y: Number(input.config.bed_size_y ?? 220), z: Number(input.config.printable_height ?? 250) });
    const headerLayerCount = text.match(/^;\s*total layer number:\s*(\d+)/m);
    const layerCount = headerLayerCount ? Number(headerLayerCount[1]) : (text.match(/^;\s*(?:CHANGE_LAYER|LAYER_CHANGE)\s*$/gm) ?? []).length;
    progress(id, 'G-code ready', 100);
    return {
      gcode,
      name: (String(input.name || 'model').replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}_. -]/gu, '_') || 'model') + '.gcode',
      statistics: plate.statistics ?? null,
      elapsedMs: performance.now() - started,
      layerCount,
    };
  } finally {
    if (session) await session.dispose();
    if (active === operation) active = null;
  }
}

self.onmessage = async ({ data }) => {
  if (data.type === 'cancel') {
    if (active && (data.id === undefined || data.id === active.id)) active.controller.abort();
    return;
  }
  const { id } = data;
  try {
    let result;
    if (data.type === 'initialize') {
      const engine = await loadEngine(id);
      result = { name: 'OrcaSlicer', version: '2.4.2', release: RELEASE, apiVersion: API_VERSION, capabilities: engine.capabilities };
    } else if (data.type === 'slice') result = await slice(id, data.payload);
    else throw new Error('Unknown slicer request.');
    self.postMessage({ type: 'result', id, result }, result.gcode ? [result.gcode.buffer] : []);
  } catch (error) {
    self.postMessage({ type: 'error', id, error: { code: error.code ?? 'ENGINE', message: error.message ?? String(error) } });
  }
};
