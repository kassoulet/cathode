#!/usr/bin/env node
/**
 * Builds Chrome and Firefox packages. The extension imports the shared Cathode core, so the
 * build also copies ../src → core/ and ../../assets/crt → crt/ (shaders, masks, presets).
 *
 *   dist/chrome/, dist/firefox/   unpacked builds
 *   dist/cathode-<target>-v<version>.zip
 */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const COPIES = [ // [from, to inside the package]
  [path.join(root, 'src'), 'src'],
  [path.join(root, 'popup'), 'popup'],
  [path.join(root, 'icons'), 'icons'],
  [path.join(root, '..', 'src'), 'core'],
  [path.join(root, '..', '..', 'assets', 'crt'), 'crt'],
];
const base = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));

function firefoxManifest(source) {
  const manifest = structuredClone(source);
  delete manifest.minimum_chrome_version;
  manifest.browser_specific_settings = {
    gecko: { id: 'cathode@cathode.app', strict_min_version: '140.0', data_collection_permissions: { required: ['none'] } },
    gecko_android: { strict_min_version: '142.0' },
  };
  return manifest;
}

await rm(dist, { recursive: true, force: true });
for (const [name, manifest] of [['chrome', base], ['firefox', firefoxManifest(base)]]) {
  const dir = path.join(dist, name);
  await mkdir(dir, { recursive: true });
  for (const [from, to] of COPIES) await cp(from, path.join(dir, to), { recursive: true });
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const archive = path.join(dist, `cathode-${name}-v${base.version}.zip`);
  try {
    execFileSync('zip', ['-r', '-q', '-X', archive, '.'], { cwd: dir, stdio: 'inherit' });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    console.warn('! `zip` not found, skipping archive');
  }
  console.log(`${name}: dist/${name}/`);
}
