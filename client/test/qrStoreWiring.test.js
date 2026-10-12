import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.resolve(__dirname, '../src');
const serverRoutesDir = path.resolve(__dirname, '../../server/routes');

const qrScannerVuePath = path.resolve(srcDir, 'components/QrScanner.vue');
const storedPartCardVuePath = path.resolve(srcDir, 'components/qr/StoredPartCard.vue');
const serverQrJsPath = path.resolve(serverRoutesDir, 'qr.js');

describe('QR Store and Undo Wiring Consistency Tests (W-1 ~ W-6)', () => {
  test('W-1: QrScanner.vue calls "/qr/store/undo" and server/routes/qr.js defines "/store/undo"', () => {
    const clientContent = fs.readFileSync(qrScannerVuePath, 'utf-8');
    const serverContent = fs.readFileSync(serverQrJsPath, 'utf-8');

    assert.match(clientContent, /api\.post\(\s*['"]\/qr\/store\/undo['"]/);
    assert.match(serverContent, /router\.post\(\s*['"]\/store\/undo['"]/);
  });

  test('W-2: QrScanner.vue does not contain storedParts', () => {
    const content = fs.readFileSync(qrScannerVuePath, 'utf-8');
    assert.doesNotMatch(content, /storedParts/);
  });

  test('W-3: QrScanner.vue uses StoredPartCard in both scan screen and done screen', () => {
    const content = fs.readFileSync(qrScannerVuePath, 'utf-8');
    assert.match(content, /import\s+StoredPartCard\s+from\s+['"]\.\/qr\/StoredPartCard\.vue['"]/);

    // <StoredPartCard が2回以上使われていること
    const matches = content.match(/<StoredPartCard/g) || [];
    assert.equal(matches.length, 2, `Expected StoredPartCard to be used exactly 2 times, found ${matches.length}`);
  });

  test('W-4: QrScanner.vue uses shouldIgnoreScan in onScanSuccess before pause', () => {
    const content = fs.readFileSync(qrScannerVuePath, 'utf-8');
    assert.match(content, /shouldIgnoreScan\s*\(/);

    const onScanMatch = content.match(/const\s+onScanSuccess\s*=\s*async\s*\([^)]*\)\s*=>\s*\{[\s\S]*?\n\};/);
    assert.ok(onScanMatch, 'onScanSuccess found');
    assert.match(onScanMatch[0], /shouldIgnoreScan\s*\(/);
  });

  test('W-5: StoredPartCard.vue uses image_path directly for src and does not use getImageUrl', () => {
    const content = fs.readFileSync(storedPartCardVuePath, 'utf-8');
    assert.match(content, /:src="part\.image_path"/);
    assert.doesNotMatch(content, /getImageUrl/);
  });

  test('W-6: StoredPartCard.vue undo button handles disabling and hiding according to status', () => {
    const content = fs.readFileSync(storedPartCardVuePath, 'utf-8');

    // 戻すボタンの表示判定（canShowUndoButton）
    assert.match(content, /canShowUndoButton/);
    // disabled 属性に undoing 状態の判定
    assert.match(content, /:disabled="status\s*===\s*'undoing'"/);
    // undoing 表示
    assert.match(content, /戻しています…/);
  });
});
