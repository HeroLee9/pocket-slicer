import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildConfig } from '../src/profiles/index.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const result = spawnSync('npm', ['run', 'build'], { cwd: root, env: { ...process.env, BASE_PATH: '/' }, stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
const destination = new URL('../ios/web/', import.meta.url);
await rm(destination, { recursive: true, force: true });
await cp(new URL('../dist/', import.meta.url), destination, { recursive: true });
if (process.argv.includes('--include-probe')) {
  const probe = new URL('native-test/', destination);
  await mkdir(probe, { recursive: true });
  await writeFile(new URL('probe.html', probe), '<!doctype html><html><head><meta charset="utf-8"><title>Pocket Slicer native engine test</title></head><body><p>Bundled engine test</p></body></html>');
  await writeFile(new URL('k1c-config.json', probe), JSON.stringify(buildConfig()));
}
console.log('Bundled local web assets in ios/web. No runtime website is required.');
