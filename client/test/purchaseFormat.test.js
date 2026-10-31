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
  formatBatchCreatedAt,
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
  test('整数でない値は小数 2 桁まで表示する（丸めない）', () => {
    assert.match(formatUnitPrice(52.5, 'JPY'), /52\.5$/);
    assert.match(formatUnitPrice(52.123, 'JPY'), /52\.12$/);
    assert.equal(formatUnitPrice(1.5, 'USD'), '$1.50');
    assert.equal(formatUnitPrice(1.234, 'USD'), '$1.23');
    assert.match(formatUnitPrice(52, 'JPY'), /52$/);
    assert.equal(formatUnitPrice('52.5', 'JPY'), formatUnitPrice(52.5, 'JPY'));
  });
  test('小数桁が 3 の通貨でも例外にしない', () => {
    assert.match(formatUnitPrice(1.5, 'KWD'), /1\.5/);
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

// タイムゾーンに依存しないよう、期待値は同じ瞬間のローカル時刻の各成分から作る
const pad = (n) => String(n).padStart(2, '0');
const localLabel = (d) =>
  `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

describe('formatBatchCreatedAt', () => {
  test('UTC の文字列をローカル時刻の YYYY/MM/DD HH:mm にする', () => {
    const expected = localLabel(new Date(Date.UTC(2026, 9, 1, 12, 34, 56)));
    assert.equal(formatBatchCreatedAt('2026-10-01 12:34:56'), expected);
  });
  test('ミリ秒付きも同じ', () => {
    const expected = localLabel(new Date(Date.UTC(2026, 9, 1, 23, 59, 1, 234)));
    assert.equal(formatBatchCreatedAt('2026-10-01 23:59:01.234'), expected);
  });
  test('Z 付きの ISO 文字列はそのまま解釈する', () => {
    const expected = localLabel(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)));
    assert.equal(formatBatchCreatedAt('2026-01-02T03:04:05Z'), expected);
  });
  test('空は空文字、解釈できない値は元の文字列の先頭 16 文字', () => {
    assert.equal(formatBatchCreatedAt(null), '');
    assert.equal(formatBatchCreatedAt('not-a-date-at-all-xyz'), 'not-a-date-at-al');
  });
});

describe('formatBatchLabel', () => {
  test('#id 日時 source（件数）', () => {
    const expected = localLabel(new Date(Date.UTC(2026, 9, 1, 12, 34, 56)));
    assert.equal(
      formatBatchLabel({ id: 3, created_at: '2026-10-01 12:34:56', source: 'amazon', created_count: 20 }),
      `#3 ${expected} amazon（20件）`
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
  test('失敗があるときは最初の 1 件の理由を添える', () => {
    const r = summarizeBulkApprove({
      approved: 1,
      failed: 2,
      results: [
        { id: 1, status: 'approved' },
        { id: 2, status: 'error', error: '承認できる候補がありません' },
        { id: 3, status: 'error', error: '別の理由' }
      ]
    });
    assert.equal(r.message, '承認 1 件、失敗 2 件（最初の失敗: 承認できる候補がありません）');
    assert.equal(r.type, 'warning');
  });
  test('失敗がなければ理由は付けない', () => {
    assert.equal(
      summarizeBulkApprove({ approved: 1, failed: 0, results: [{ id: 1, status: 'approved' }] }).message,
      '承認 1 件、失敗 0 件'
    );
  });
});

describe('initialPartSearch', () => {
  test('商品名を使い、コードは使わない', () => {
    assert.equal(initialPartSearch({ code: ' ABC-1 ', name: ' 抵抗 ' }), '抵抗');
    assert.equal(initialPartSearch({ code: 'ABC-1', name: null }), '');
    assert.equal(initialPartSearch({}), '');
  });
});
