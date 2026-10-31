import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const read = (rel) => fs.readFileSync(path.resolve(srcDir, rel), 'utf-8');

describe('購入履歴画面の配線', () => {
  test('サイドバーに「購入履歴」の入口があり、使用済みの下にある', () => {
    const c = read('components/layout/AppSidebar.vue');
    assert.match(c, /selectView\('purchases'\)/);
    assert.match(c, /購入履歴/);
    assert.ok(c.indexOf("selectView('used-parts')") < c.indexOf("selectView('purchases')"));
  });

  test('モバイルの「その他」に入口があり、App.vue の onTabNavigate につながる', () => {
    const sheet = read('components/layout/MobileMoreSheet.vue');
    assert.match(sheet, /\$emit\('navigate', 'purchases'\)/);
    assert.match(sheet, /'navigate'/);
    const app = read('App.vue');
    assert.match(app, /<MobileMoreSheet[\s\S]*?@navigate="onTabNavigate"/);
  });

  test('トップバーの見出しに「購入履歴」がある', () => {
    const c = read('components/layout/AppTopBar.vue');
    assert.match(c, /case 'purchases':\s*return '購入履歴'/);
  });

  test('App.vue が PurchasesView を currentView==="purchases" で表示し、edit を openEditModal へ渡す', () => {
    const c = read('App.vue');
    assert.match(c, /import PurchasesView from/);
    assert.match(c, /<PurchasesView[^>]*v-else-if="currentView === 'purchases'"/);
    assert.match(c, /<PurchasesView[\s\S]*?@edit="openEditModal"/);
  });

  test('PurchasesView が必要な API を呼んでいる', () => {
    const c = read('components/PurchasesView.vue');
    assert.match(c, /api\.get\('\/purchases',/);
    assert.match(c, /\/purchases\/shops/);
    assert.match(c, /\/purchases\/batches/);
    assert.match(c, /approve-suggestion`/);
    assert.match(c, /reject-suggestion`/);
    assert.match(c, /\/purchases\/approve-suggestions/);
    assert.match(c, /api\.patch\(`\/purchases\/\$\{item\.id\}`, \{ part_id: null \}\)/);
    assert.match(c, /api\.get\(`\/parts\/\$\{item\.part_id\}`\)/);
  });

  test('link_status を送っている（ユーティリティ経由）', () => {
    assert.match(read('utils/purchaseFormat.js'), /params\.link_status\s*=/);
    assert.match(read('components/PurchasesView.vue'), /buildPurchaseParams/);
    assert.match(read('components/PurchasesView.vue'), /value: 'unlinked'[\s\S]*value: 'suggested'[\s\S]*value: 'linked'/);
  });

  test('解除は confirm で確認し、部品側が戻らないことを書いている', () => {
    const c = read('components/PurchasesView.vue');
    const unlink = c.slice(c.indexOf('const unlink'));
    assert.match(unlink, /confirm\(/);
    assert.match(unlink, /元に戻りません/);
    assert.ok(unlink.indexOf('confirm(') < unlink.indexOf('part_id: null'));
  });

  test('一括承認は「候補あり」表示のときだけチェックボックスと承認ボタンを出す', () => {
    const c = read('components/PurchasesView.vue');
    assert.match(c, /bulkMode = computed\(\(\) => linkStatus\.value === 'suggested'\)/);
    assert.match(c, /v-if="bulkMode && items\.length > 0"/);
    assert.match(c, /選択した候補を承認（\{\{ selectedIds\.length \}\}件）/);
  });

  test('キーワード検索は 300ms のデバウンス、1 ページ 100 件', () => {
    assert.match(read('components/PurchasesView.vue'), /setTimeout\(resetAndFetch, 300\)/);
    assert.match(read('utils/purchaseFormat.js'), /PAGE_SIZE = 100/);
  });

  test('PartPickerModal が /parts を search で検索し、PATCH の part_id で確定する', () => {
    const m = read('components/purchases/PartPickerModal.vue');
    assert.match(m, /api\.get\('\/parts', \{ params \}\)/);
    assert.match(m, /params\.search\s*=/);
    assert.match(read('components/PurchasesView.vue'), /api\.patch\(`\/purchases\/\$\{item\.id\}`, \{ part_id: part\.id \}\)/);
  });
});
