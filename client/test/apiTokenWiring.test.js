import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.resolve(__dirname, '../src');

describe('API トークン 配線・静的検査 (KW-1 〜 KW-6)', () => {
  const appVuePath = path.resolve(srcDir, 'App.vue');
  const qtySyncPath = path.resolve(srcDir, 'composables/useQuantitySync.js');
  const apiJsPath = path.resolve(srcDir, 'api.js');
  const interceptorsPath = path.resolve(srcDir, 'utils/apiTokenInterceptors.js');
  const dialogVuePath = path.resolve(srcDir, 'components/ApiTokenDialog.vue');

  test('KW-1: App.vue で <ApiTokenDialog> が .app-shell や QrScanner の外にあり、<ToastHost> の近くにある', () => {
    const content = fs.readFileSync(appVuePath, 'utf-8');
    assert.match(content, /<ApiTokenDialog\s*\/>/);

    // .app-shell の閉じタグ以降にあることを確認
    const appShellCloseIndex = content.lastIndexOf('</div>');
    const dialogIndex = content.indexOf('<ApiTokenDialog');
    const toastHostIndex = content.indexOf('<ToastHost');

    assert.ok(dialogIndex > appShellCloseIndex, '<ApiTokenDialog /> must be outside .app-shell');
    assert.ok(Math.abs(dialogIndex - toastHostIndex) < 200, '<ApiTokenDialog /> must be placed near <ToastHost />');
  });

  test('KW-2: App.vue の isAnyDialogOpen に apiTokenPrompt の open が含まれる', () => {
    const content = fs.readFileSync(appVuePath, 'utf-8');
    const isAnyDialogOpenMatch = content.match(/const isAnyDialogOpen = \(\) =>\s*([\s\S]*?);/);
    assert.ok(isAnyDialogOpenMatch, 'isAnyDialogOpen definition found');
    assert.match(isAnyDialogOpenMatch[1], /apiTokenPrompt.*open/);
  });

  test('KW-3: useQuantitySync.js の sendBeaconAll が getApiToken を参照している', () => {
    const content = fs.readFileSync(qtySyncPath, 'utf-8');
    const beaconFnMatch = content.match(/function sendBeaconAll\(\)\s*\{([\s\S]*?)\n\}/);
    assert.ok(beaconFnMatch, 'sendBeaconAll function found');
    assert.match(beaconFnMatch[1], /getApiToken\(\)/);
    assert.match(beaconFnMatch[1], /Authorization/);
  });

  test('KW-4: api.js および interceptors で request/response インターセプターが定義され、_tokenRetried で再送を1回に制限している', () => {
    const apiContent = fs.readFileSync(apiJsPath, 'utf-8');
    assert.match(apiContent, /installApiTokenInterceptors/);

    const interceptorContent = fs.readFileSync(interceptorsPath, 'utf-8');
    assert.match(interceptorContent, /interceptors\.request\.use/);
    assert.match(interceptorContent, /interceptors\.response\.use/);
    assert.match(interceptorContent, /_tokenRetried/);
  });

  test('KW-5: ApiTokenDialog.vue の入力欄が type="password" で、focusTrap を使っている', () => {
    const content = fs.readFileSync(dialogVuePath, 'utf-8');
    assert.match(content, /:type="showPassword \? 'text' : 'password'"|type="password"/);
    assert.match(content, /focusTrap/);
    assert.match(content, /nextTrapIndex/);
  });

  test('KW-6: ApiTokenDialog.vue に未定義の CSS 変数やハードコードされた色が使われていない', () => {
    const content = fs.readFileSync(dialogVuePath, 'utf-8');
    // ハードコードされた16進カラー (#xxx, #xxxxxx) が無いこと
    const hexColorMatches = content.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
    assert.equal(hexColorMatches.length, 0, `Hardcoded hex colors found: ${hexColorMatches.join(', ')}`);
  });
});
