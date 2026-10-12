import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDir = path.resolve(__dirname, '..');
const srcDir = path.resolve(clientDir, 'src');

const viteConfigPath = path.resolve(clientDir, 'vite.config.js');
const appVuePath = path.resolve(srcDir, 'App.vue');
const useAppUpdatePath = path.resolve(srcDir, 'composables/useAppUpdate.js');
const useToastPath = path.resolve(srcDir, 'composables/useToast.js');
const toastHostVuePath = path.resolve(srcDir, 'components/ToastHost.vue');
const partsListVuePath = path.resolve(srcDir, 'components/PartsList.vue');
const locationGridVuePath = path.resolve(srcDir, 'components/LocationGridView.vue');

describe('PWA Update and Cache Purge Wiring Tests (W-1 ~ W-12)', () => {
  test('W-1: vite.config.js includes injectRegister: false', () => {
    const content = fs.readFileSync(viteConfigPath, 'utf-8');
    assert.match(content, /injectRegister\s*:\s*false/);
  });

  test('W-2: vite.config.js includes navigateFallbackDenylist containing api, uploads, and version', () => {
    const content = fs.readFileSync(viteConfigPath, 'utf-8');
    const match = content.match(/navigateFallbackDenylist\s*:\s*\[([\s\S]*?)\]/);
    assert.ok(match, 'navigateFallbackDenylist found in vite.config.js');
    const denylistText = match[1];
    assert.match(denylistText, /api/);
    assert.match(denylistText, /uploads/);
    assert.match(denylistText, /version/);
  });

  test('W-3: vite.config.js includes skipWaiting: true and clientsClaim: true', () => {
    const content = fs.readFileSync(viteConfigPath, 'utf-8');
    assert.match(content, /skipWaiting\s*:\s*true/);
    assert.match(content, /clientsClaim\s*:\s*true/);
  });

  test('W-4: vite.config.js emits version.json and defines __APP_BUILD_ID__', () => {
    const content = fs.readFileSync(viteConfigPath, 'utf-8');
    assert.match(content, /version\.json/);
    assert.match(content, /__APP_BUILD_ID__\s*:/);
  });

  test('W-5: vite.config.js maintains runtimeCaching with epm-fonts-jp', () => {
    const content = fs.readFileSync(viteConfigPath, 'utf-8');
    assert.match(content, /runtimeCaching\s*:\s*\[/);
    assert.match(content, /cacheName\s*:\s*['"]epm-fonts-jp['"]/);
  });

  test('W-6: App.vue calls useAppUpdate and isBusy includes currentPage, hasPending, and child refs', () => {
    const content = fs.readFileSync(appVuePath, 'utf-8');
    assert.match(content, /useAppUpdate\s*\(\s*\{/);
    assert.match(content, /isBusy\s*:\s*isAppBusy/);
    assert.match(content, /const isAppBusy = \(\) =>/);
    assert.match(content, /currentPage\.value === 'qr'/);
    assert.match(content, /qtySync\.hasPending\(\)/);
    assert.match(content, /partsListRef\.value\?\.isBusy\?\.\(\)/);
    assert.match(content, /locationGridRef\.value\?\.isBusy\?\.\(\)/);
  });

  test('W-7: useAppUpdate.js registers visibilitychange and vite:preloadError, and cleans up with removeEventListener', () => {
    const content = fs.readFileSync(useAppUpdatePath, 'utf-8');
    assert.match(content, /addEventListener\s*\(\s*['"]visibilitychange['"]/);
    assert.match(content, /addEventListener\s*\(\s*['"]vite:preloadError['"]/);
    assert.match(content, /removeEventListener\s*\(\s*['"]visibilitychange['"]/);
    assert.match(content, /removeEventListener\s*\(\s*['"]vite:preloadError['"]/);
  });

  test('W-8: useAppUpdate.js narrows caches.delete to workbox-precache, runs only when not switched, and does not call unregister', () => {
    const content = fs.readFileSync(useAppUpdatePath, 'utf-8');
    assert.match(content, /!switched\s*&&\s*['"]caches['"]\s*in\s*window/);
    assert.match(content, /caches\.delete\s*\(/);
    assert.match(content, /startsWith\s*\(\s*['"]workbox-precache['"]\)/);
    assert.doesNotMatch(content, /\.unregister\s*\(/);
  });

  test('W-9: useToast.js supports action and ToastHost.vue renders action.label', () => {
    const toastContent = fs.readFileSync(useToastPath, 'utf-8');
    const hostContent = fs.readFileSync(toastHostVuePath, 'utf-8');
    assert.match(toastContent, /action\s*:\s*opts\.action/);
    assert.match(hostContent, /toast\.action\.label/);
  });

  test('W-10: useAppUpdate.js rechecks isBusy before reload unless forceReload is true', () => {
    const content = fs.readFileSync(useAppUpdatePath, 'utf-8');
    assert.match(content, /!forceReload\s*&&\s*typeof isBusy === 'function'\s*&&\s*isBusy\(\)/);
    assert.match(content, /notifyUser\s*\(/);
  });

  test('W-11: useAppUpdate.js uses force: true for vite:preloadError and onUpdateActivated, and passes fromSwActivated: true', () => {
    const content = fs.readFileSync(useAppUpdatePath, 'utf-8');
    assert.match(content, /checkForUpdate\(\{\s*force:\s*true\s*\}\)/);
    assert.match(content, /checkForUpdate\(\{\s*force:\s*true,\s*fromSwActivated:\s*true\s*\}\)/);
  });

  test('W-12: PartsList.vue and LocationGridView.vue expose isBusy via defineExpose', () => {
    const partsListContent = fs.readFileSync(partsListVuePath, 'utf-8');
    const locationGridContent = fs.readFileSync(locationGridVuePath, 'utf-8');
    assert.match(partsListContent, /isBusy\s*:\s*\(\)\s*=>/);
    assert.match(partsListContent, /showBulkEditModal/);
    assert.match(partsListContent, /showAiBatchModal/);
    assert.match(partsListContent, /aiBatchProgress\.value\.running/);
    assert.match(partsListContent, /selectedParts\.value\.length > 0/);
    assert.match(locationGridContent, /isBusy\s*:\s*\(\)\s*=>\s*!!previewLocation\.value/);
  });
});
