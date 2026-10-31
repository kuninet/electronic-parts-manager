import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAGE_SIZE,
  formatUnitPrice,
  pageRange,
  pagerState,
  buildPurchaseParams,
  buildCurrencyOptions,
  formatBatchLabel,
  describePartUpdated,
  buildLinkMessage,
  summarizeBulkApprove,
  initialPartSearch
} from '../src/utils/purchaseFormat.js';

describe('formatUnitPrice', () => {
  test('USD は $1.23 形式', () => {
    assert.equal(formatUnitPrice(1.23, 'USD'), '$1.23');
  });
  test('JPY は円記号付き（小数なし）', () => {
    assert.match(formatUnitPrice(1500, 'JPY'), /1,500$/);
    assert.match(formatUnitPrice(1500, 'JPY'), /[¥￥]/);
  });
  test('通貨未指定は JPY 扱い', () => {
    assert.equal(formatUnitPrice(100, null), formatUnitPrice(100, 'JPY'));
  });
  test('null / 空 / 非数は "-"', () => {
    assert.equal(formatUnitPrice(null, 'JPY'), '-');
    assert.equal(formatUnitPrice(undefined, 'JPY'), '-');
    assert.equal(formatUnitPrice('', 'JPY'), '-');
    assert.equal(formatUnitPrice('abc', 'JPY'), '-');
  });
  test('0 は表示する', () => {
    assert.notEqual(formatUnitPrice(0, 'USD'), '-');
  });
  test('不正な通貨コードでも例外にしない', () => {
    assert.equal(formatUnitPrice(5, 'ZZ$'), '5 ZZ$');
  });
});

describe('ページング', () => {
  test('pageRange', () => {
    assert.deepEqual(pageRange(250, 100, 100), { start: 101, end: 200 });
    assert.deepEqual(pageRange(0, 0, 0), { start: 0, end: 0 });
    assert.deepEqual(pageRange(3, 0, 3), { start: 1, end: 3 });
  });
  test('pagerState', () => {
    assert.deepEqual(pagerState(250, 0), { hasPrev: false, hasNext: true });
    assert.deepEqual(pagerState(250, 200), { hasPrev: true, hasNext: false });
    assert.deepEqual(pagerState(100, 0), { hasPrev: false, hasNext: false });
  });
});

describe('buildPurchaseParams', () => {
  test('空の条件は送らず、limit/offset は常に付く', () => {
    assert.deepEqual(buildPurchaseParams({}), { limit: PAGE_SIZE, offset: 0 });
  });
  test('link_status・各条件を API 名に変換する', () => {
    const p = buildPurchaseParams(
      { linkStatus: 'suggested', shop: 'Digi-Key', from: '2026-01-01', to: '2026-02-01', currency: 'USD', search: ' 抵抗 ', batchId: '12' },
      200
    );
    assert.deepEqual(p, {
      limit: 100, offset: 200, link_status: 'suggested', shop: 'Digi-Key',
      from: '2026-01-01', to: '2026-02-01', currency: 'USD', search: '抵抗', batch_id: '12'
    });
  });
  test('空白だけの検索語は送らない', () => {
    assert.equal('search' in buildPurchaseParams({ search: '   ' }), false);
  });
});

describe('buildCurrencyOptions', () => {
  test('固定の通貨に、出てきた通貨を重複なく足す', () => {
    assert.deepEqual(buildCurrencyOptions(['usd', 'CNY', 'JPY', null, ' gbp ']), ['JPY', 'USD', 'EUR', 'AUD', 'CNY', 'GBP']);
  });
});

describe('formatBatchLabel', () => {
  test('#id 日時 source（件数）', () => {
    assert.equal(
      formatBatchLabel({ id: 3, created_at: '2026-10-01 12:34:56', source: 'amazon', created_count: 20 }),
      '#3 2026-10-01 12:34 amazon（20件）'
    );
  });
  test('取り消し済みは印を付ける', () => {
    assert.match(formatBatchLabel({ id: 1, created_count: 0, undone_at: '2026-10-02' }), /取り消し済み/);
  });
});

describe('part_updated の文言', () => {
  test('変えた項目だけを並べる', () => {
    assert.equal(
      describePartUpdated({ part_id: 1, fields: { shop: 'A', purchased_at: '2026-01-01', unit_price: 10 } }),
      '部品の購入情報を更新しました（購入先・購入日・単価）'
    );
    assert.equal(
      describePartUpdated({ part_id: 1, fields: { unit_price: 10 } }),
      '部品の購入情報を更新しました（単価）'
    );
  });
  test('null / 空 fields は空文字', () => {
    assert.equal(describePartUpdated(null), '');
    assert.equal(describePartUpdated({ part_id: 1, fields: {} }), '');
  });
  test('buildLinkMessage', () => {
    assert.equal(buildLinkMessage('承認しました', null), '承認しました');
    assert.equal(
      buildLinkMessage('承認しました', { part_id: 1, fields: { shop: 'A' } }),
      '承認しました。部品の購入情報を更新しました（購入先）'
    );
  });
});

describe('summarizeBulkApprove', () => {
  test('承認 N 件、失敗 M 件', () => {
    assert.deepEqual(summarizeBulkApprove({ approved: 3, failed: 0 }), { message: '承認 3 件、失敗 0 件', type: 'success' });
    assert.equal(summarizeBulkApprove({ approved: 2, failed: 1 }).type, 'warning');
    assert.equal(summarizeBulkApprove({ approved: 0, failed: 2 }).type, 'error');
  });
});

describe('initialPartSearch', () => {
  test('コード優先、なければ商品名', () => {
    assert.equal(initialPartSearch({ code: ' ABC-1 ', name: '抵抗' }), 'ABC-1');
    assert.equal(initialPartSearch({ code: null, name: '抵抗' }), '抵抗');
    assert.equal(initialPartSearch({}), '');
  });
});
