import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';

const output = resolve(process.argv[2] || 'dist');
const configuredBase = process.env.BASE_PATH || '/';
const basePath = configuredBase.endsWith('/') ? configuredBase : configuredBase + '/';
if (!basePath.startsWith('/') || basePath.startsWith('//') || /[?#\\]/.test(basePath) || new URL(basePath, 'https://pocket.invalid').pathname !== basePath) {
  throw new Error('BASE_PATH must be an absolute URL path, such as / or /pocket-slicer/.');
}
const assets = [];
const version = createHash('sha256');
async function walk(directory) {
  for (const name of (await readdir(directory)).sort()) {
    if (name.startsWith('.') || ['_headers', 'sw.js', 'offline-manifest.json'].includes(name)) continue;
    const filename = resolve(directory, name);
    const info = await stat(filename);
    if (info.isDirectory()) { await walk(filename); continue; }
    const relativeName = relative(output, filename).split(sep).map(encodeURIComponent).join('/');
    // Static hosts redirect index.html to the app root, including project subpaths.
    const url = relativeName === 'index.html' ? basePath : basePath + relativeName;
    const bytes = await readFile(filename);
    version.update(url).update(bytes);
    assets.push({ url, bytes: info.size, sha256: createHash('sha256').update(bytes).digest('hex'), document: relativeName.endsWith('.html') });
  }
}
await walk(output);
const manifest = { app: 'pocket-slicer', format: 1, basePath, version: version.digest('hex').slice(0, 16), assets };
await writeFile(resolve(output, 'offline-manifest.json'), JSON.stringify(manifest));
console.log(`Offline manifest: ${assets.length} files, ${(assets.reduce((total, asset) => total + asset.bytes, 0) / 1024 / 1024).toFixed(1)} MiB`);
