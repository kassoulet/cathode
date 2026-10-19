#!/usr/bin/env node
/**
 * Builds installable packages for Chrome and Firefox from the shared source.
 *
 *   dist/chrome/   unpacked Chrome/Edge/Brave build  (load unpacked)
 *   dist/firefox/  unpacked Firefox build            (load temporary add-on)
 *   dist/cathode-chrome-v<version>.zip
 *   dist/cathode-firefox-v<version>.zip
 */

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const ASSETS = ['src', 'popup', 'icons'];
const GECKO_ID = 'cathode@cathode.app';

const base = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
const version = base.version;

function firefoxManifest(source) {
  const manifest = structuredClone(source);
  delete manifest.minimum_chrome_version;
  manifest.browser_specific_settings = {
    gecko: {
      id: GECKO_ID,
      strict_min_version: '140.0',
      data_collection_permissions: {
        required: ['none']
      }
    },
    gecko_android: {
      strict_min_version: '142.0'
    }
  };
  return manifest;
}

async function stage(target, manifest) {
  const dir = path.join(dist, target);
  await mkdir(dir, { recursive: true });

  for (const asset of ASSETS) {
    await cp(path.join(root, asset), path.join(dir, asset), { recursive: true });
  }

  await writeFile(
    path.join(dir, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n'
  );

  return dir;
}

function zip(dir, outfile) {
  try {
    execFileSync('zip', ['-r', '-q', '-X', outfile, '.'], { cwd: dir, stdio: 'inherit' });
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.warn('  ! `zip` not found — skipping archive (unpacked folder is ready)');
      return false;
    }
    throw error;
  }
}

await rm(dist, { recursive: true, force: true });

const targets = [
  { name: 'chrome', manifest: base, label: 'Chrome / Edge / Brave' },
  { name: 'firefox', manifest: firefoxManifest(base), label: 'Firefox' }
];

for (const target of targets) {
  const dir = await stage(target.name, target.manifest);
  const archive = path.join(dist, `cathode-${target.name}-v${version}.zip`);

  console.log(`\n${target.label}`);
  console.log(`  unpacked: dist/${target.name}/`);

  if (zip(dir, archive)) {
    console.log(`  archive:  dist/${path.basename(archive)}`);
  }
}

console.log(`\nBuilt Cathode v${version}.`);
