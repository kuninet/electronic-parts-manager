/**
 * 購入履歴画面の表示・組み立てに使う純関数
 */

export const PAGE_SIZE = 100;

// 部品側の自動更新で変わる項目名 → 表示名
const FIELD_LABELS = {
  shop: '購入先',
  purchased_at: '購入日',
  unit_price: '単価'
};

/**
 * 単価を通貨付きで整形する。null / 不正値は '-'。
 * 通貨コードが不正で Intl が例外を投げる場合は「数値 通貨コード」で返す。
 */
export function formatUnitPrice(value, currency) {
  if (value === null || value === undefined || value === '') return '-';
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  const code = typeof currency === 'string' && currency.trim() ? currency.trim().toUpperCase() : 'JPY';
  try {
    const base = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: code });
    if (Number.isInteger(num)) return base.format(num);
    // 整数でない値は小数 2 桁まで表示する（JPY の 52.5 が 53 に丸められないように）
    const minimumFractionDigits = Math.min(base.resolvedOptions().minimumFractionDigits, 2);
    return new Intl.NumberFormat('ja-JP', {
      style: 'currency',
      currency: code,
      minimumFractionDigits,
      maximumFractionDigits: 2
    }).format(num);
  } catch {
    return `${num} ${code}`;
  }
}

/**
 * 「全 N 件中 a〜b 件」の範囲。0 件のときは start/end とも 0。
 */
export function pageRange(total, offset, count) {
  if (!total || !count) return { start: 0, end: 0 };
  return { start: offset + 1, end: offset + count };
}

/**
 * 次ページ・前ページへ動けるか。
 */
export function pagerState(total, offset, limit = PAGE_SIZE) {
  return {
    hasPrev: offset > 0,
    hasNext: offset + limit < total
  };
}

/**
 * 一覧 API のクエリを組み立てる。空の条件は送らない。
 * @param {object} f { linkStatus, shop, from, to, currency, search, batchId }
 */
export function buildPurchaseParams(f, offset = 0, limit = PAGE_SIZE) {
  const params = { limit, offset };
  if (f.linkStatus) params.link_status = f.linkStatus;
  if (f.shop) params.shop = f.shop;
  if (f.from) params.from = f.from;
  if (f.to) params.to = f.to;
  if (f.currency) params.currency = f.currency;
  const search = typeof f.search === 'string' ? f.search.trim() : '';
  if (search) params.search = search;
  if (f.batchId) params.batch_id = f.batchId;
  return params;
}

/**
 * 通貨セレクトの選択肢。固定の通貨に、一覧に出てきた通貨を加える（重複なし・大文字）。
 */
export function buildCurrencyOptions(seen = []) {
  const base = ['JPY', 'USD', 'EUR', 'AUD'];
  const result = [...base];
  for (const c of seen) {
    if (typeof c !== 'string') continue;
    const code = c.trim().toUpperCase();
    if (code && !result.includes(code)) result.push(code);
  }
  return result;
}

/**
 * バッチの作成日時（サーバーは UTC の 'YYYY-MM-DD HH:MM:SS' またはミリ秒付きで返す）を
 * ローカル時刻の 'YYYY/MM/DD HH:mm' にする。解釈できなければ元の文字列の先頭 16 文字。
 */
export function formatBatchCreatedAt(value) {
  if (!value) return '';
  const raw = String(value).trim();
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const date = new Date(hasZone ? raw : `${raw.replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return raw.replace('T', ' ').slice(0, 16);
  return date.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

/**
 * 取り込みバッチのセレクト表示: `#id 日時 source（作成件数）`。取り消し済みは印を付ける。
 */
export function formatBatchLabel(batch) {
  const created = formatBatchCreatedAt(batch.created_at);
  const parts = [`#${batch.id}`];
  if (created) parts.push(created);
  if (batch.source) parts.push(batch.source);
  const count = batch.created_count ?? batch.created ?? 0;
  let label = `${parts.join(' ')}（${count}件）`;
  if (batch.undone_at) label += ' [取り消し済み]';
  return label;
}

/**
 * part_updated から「部品の購入情報を更新しました（購入先・購入日・単価）」を作る。
 * 更新がなければ空文字。
 */
export function describePartUpdated(partUpdated) {
  if (!partUpdated || !partUpdated.fields) return '';
  const names = Object.keys(partUpdated.fields)
    .map((k) => FIELD_LABELS[k])
    .filter(Boolean);
  if (names.length === 0) return '';
  return `部品の購入情報を更新しました（${names.join('・')}）`;
}

/**
 * 承認・ひも付け成功時の toast 文。
 */
export function buildLinkMessage(base, partUpdated) {
  const extra = describePartUpdated(partUpdated);
  return extra ? `${base}。${extra}` : base;
}

/**
 * 一括承認の結果 toast 文と種別。
 */
export function summarizeBulkApprove(result) {
  const approved = result?.approved ?? 0;
  const failed = result?.failed ?? 0;
  const firstError = Array.isArray(result?.results)
    ? result.results.find((r) => r && r.status === 'error' && r.error)
    : null;
  const reason = failed > 0 && firstError ? `（最初の失敗: ${firstError.error}）` : '';
  return {
    message: `承認 ${approved} 件、失敗 ${failed} 件${reason}`,
    type: failed > 0 ? (approved > 0 ? 'warning' : 'error') : 'success'
  };
}

/**
 * 部品ピッカーの検索初期値: 商品名。
 * 通販コードは部品の名前・型番と一致しにくく、候補が 0 件になりやすいので使わない。
 */
export function initialPartSearch(record) {
  return typeof record?.name === 'string' ? record.name.trim() : '';
}
