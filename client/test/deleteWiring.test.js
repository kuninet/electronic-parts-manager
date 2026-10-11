import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BULK_ACTION, BULK_MAX_IDS } from '../src/constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.resolve(__dirname, '../src');

const partsListVuePath = path.resolve(srcDir, 'components/PartsList.vue');
const partFormVuePath = path.resolve(srcDir, 'components/PartForm.vue');
const appVuePath = path.resolve(srcDir, 'App.vue');
const masterDataVuePath = path.resolve(srcDir, 'components/MasterDataManagement.vue');
const qtySyncPath = path.resolve(srcDir, 'composables/useQuantitySync.js');

describe('Part Deletion & Bulk Action Wiring Tests (W-1 ~ W-10)', () => {
  test('W-1: PartsList.vue uses /parts/bulk/action and /parts/bulk/update with { ids, updates }', () => {
    const content = fs.readFileSync(partsListVuePath, 'utf-8');
    assert.match(content, /\/parts\/bulk\/action/);
    assert.match(content, /\/parts\/bulk\/update/);
    assert.match(content, /api\.post\(\s*['"]\/parts\/bulk\/update['"]\s*,\s*\{\s*ids[\s\S]*?updates/);
  });

  test('W-2: PartsList.vue calls /ai-naming/suggest/:id in batch processing', () => {
    const content = fs.readFileSync(partsListVuePath, 'utf-8');
    assert.match(content, /`\/ai-naming\/suggest\/\$\{part\.id\}`/);
  });

  test('W-3: constants.js defines BULK_ACTION and BULK_MAX_IDS', () => {
    assert.equal(BULK_ACTION.TRASH, 'trash');
    assert.equal(BULK_ACTION.RESTORE, 'restore');
    assert.equal(BULK_ACTION.PERMANENT_DELETE, 'delete');
    assert.equal(BULK_MAX_IDS, 500);
  });

  test('W-4: PartForm.vue has delete logic, warning text, and trash button is not in form-actions-top', () => {
    const content = fs.readFileSync(partFormVuePath, 'utf-8');
    assert.match(content, /api\.delete\(/);
    assert.match(content, /emit\('deleted'/);
    assert.match(content, /QRコードの紐付けは解除/);

    const topActionsMatch = content.match(/<div class="form-actions-top">([\s\S]*?)<\/div>/);
    assert.ok(topActionsMatch, 'form-actions-top exists');
    assert.ok(!topActionsMatch[1].includes('canTrash'), 'v-if="canTrash" must not be inside form-actions-top');
    assert.ok(!topActionsMatch[1].includes('ゴミ箱へ移動'), 'Trash button must not be inside form-actions-top');
  });

  test('W-5: App.vue binds @deleted and @restored on PartForm', () => {
    const content = fs.readFileSync(appVuePath, 'utf-8');
    const partFormMatch = content.match(/<PartForm[\s\S]*?\/>/);
    assert.ok(partFormMatch, '<PartForm /> exists in App.vue');
    assert.match(partFormMatch[0], /@deleted="handleSaved"/);
    assert.match(partFormMatch[0], /@restored="handleSaved"/);
  });

  test('W-6: useQuantitySync.js returns discard and has guards in flush', () => {
    const content = fs.readFileSync(qtySyncPath, 'utf-8');
    assert.match(content, /discard\s*[,}]/);
    const guardMatches = content.match(/if\s*\(!entries\.get\(id\)\)\s*return;/g) || [];
    assert.ok(guardMatches.length >= 2, `Expected at least 2 guards in flush, found ${guardMatches.length}`);
  });

  test('W-7: PartForm.vue implements restore with canRestore and exclusive condition', () => {
    const content = fs.readFileSync(partFormVuePath, 'utf-8');
    assert.match(content, /`\/parts\/\$\{p\.id\}\/restore`/);
    assert.match(content, /canRestore/);
    assert.match(content, /ゴミ箱から復元/);
    assert.match(content, /v-else-if="canRestore"/);
  });

  test('W-8: PartsList.vue prompts confirm before trashing with BULK_ACTION.TRASH', () => {
    const content = fs.readFileSync(partsListVuePath, 'utf-8');
    const bulkActionFnMatch = content.match(/const handleBulkAction = async \([^)]*\) =>\s*\{([\s\S]*?)\n\};/);
    assert.ok(bulkActionFnMatch, 'handleBulkAction found');
    assert.match(bulkActionFnMatch[1], /action === BULK_ACTION\.TRASH/);
    assert.match(bulkActionFnMatch[1], /confirm\(/);
  });

  test('W-9: MasterDataManagement.vue deleteLocation warns about storage logs and unassigned location', () => {
    const content = fs.readFileSync(masterDataVuePath, 'utf-8');
    const deleteLocMatch = content.match(/const deleteLocation = async \([^)]*\) =>\s*\{([\s\S]*?)\n\};/);
    assert.ok(deleteLocMatch, 'deleteLocation found');
    assert.match(deleteLocMatch[1], /入庫履歴/);
    assert.match(deleteLocMatch[1], /場所未設定/);
  });

  test('W-10: MasterDataManagement.vue deleteCategory warns about uncategorized and used parts, and passes cat in template', () => {
    const content = fs.readFileSync(masterDataVuePath, 'utf-8');
    const deleteCatMatch = content.match(/const deleteCategory = async \([^)]*\) =>\s*\{([\s\S]*?)\n\};/);
    assert.ok(deleteCatMatch, 'deleteCategory found');
    assert.match(deleteCatMatch[1], /未分類/);
    assert.match(deleteCatMatch[1], /使用済み/);
    assert.match(content, /deleteCategory\(cat\)/);
  });
});
