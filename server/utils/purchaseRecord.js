const { normalizeShop, normalizePurchasedAt, normalizeUnitPrice, SHOP_MAX_LENGTH } = require('./purchaseInfo');

const ORDER_ID_MAX_LENGTH = 100;
const CODE_MAX_LENGTH = 100;
const NAME_MAX_LENGTH = 500;
const SOURCE_MSG_ID_MAX_LENGTH = 200;
const NOTE_MAX_LENGTH = 2000;
const SUGGESTION_NOTE_MAX_LENGTH = 1000;
const DEFAULT_CURRENCY = 'JPY';

// 正規化の対象項目（この順で検証し、最初のエラーを返す）
const FIELDS = [
  'shop', 'order_id', 'line_no', 'purchased_at', 'code', 'name',
  'unit_price', 'currency', 'quantity', 'part_id', 'source_msg_id', 'note',
  'suggested_part_id', 'suggestion_note'
];

// 重複キーの材料になる項目（変更されたらキーを作り直す）
const KEY_FIELDS = ['shop', 'order_id', 'line_no', 'name', 'source_msg_id'];

/**
 * 文字列または数値を trim した文字列にする。空文字・null・文字列 'null'（大文字小文字不問）は null、undefined は未送信
 * 文字列・数値以外はエラー
 *
 * @param {string} field 項目名（エラー文言用）
 * @param {any} val
 * @param {number} maxLength
 * @returns {{ value?: string|null, error?: string }}
 */
function normalizeOptionalText(field, val, maxLength) {
  if (val === undefined) return { value: undefined };
  if (val === null) return { value: null };
  if (typeof val !== 'string' && typeof val !== 'number') {
    return { error: `${field} は文字列で指定してください` };
  }
  const str = String(val).trim();
  if (str === '' || str.toLowerCase() === 'null') return { value: null };
  if (str.length > maxLength) {
    return { error: `${field} は${maxLength}文字以内で指定してください` };
  }
  return { value: str };
}

/**
 * 0 以上の整数（数値、または数字だけの文字列）にする。空文字・null・文字列 'null' は null、undefined は未送信
 *
 * @param {string} field
 * @param {any} val
 * @param {{ min?: number }} [options]
 * @returns {{ value?: number|null, error?: string }}
 */
function normalizeInteger(field, val, { min = 0 } = {}) {
  if (val === undefined) return { value: undefined };
  if (val === null) return { value: null };
  const label = min > 0 ? '正の整数' : '0以上の整数';
  const errorResult = { error: `${field} は${label}で指定してください` };

  let num;
  if (typeof val === 'number') {
    num = val;
  } else if (typeof val === 'string') {
    const str = val.trim();
    if (str === '' || str.toLowerCase() === 'null') return { value: null };
    if (!/^\d+$/.test(str)) return errorResult;
    num = Number(str);
  } else {
    return errorResult;
  }

  if (!Number.isSafeInteger(num) || num < min) return errorResult;
  return { value: num };
}

/**
 * 購入明細 1 件を正規化・検証する
 * - partial: false（既定）は登録用。shop と name が必須で、未送信の項目は null（currency は 'JPY'）になる
 * - partial: true は PATCH 用。未送信（undefined）の項目は value に含めない
 *
 * @param {any} input
 * @param {{ partial?: boolean }} [options]
 * @returns {{ value?: Record<string, any>, error?: string }}
 */
function normalizePurchaseRecord(input, { partial = false } = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { error: '明細はオブジェクトで指定してください' };
  }

  const out = {};

  // shop: 必須
  if (input.shop !== undefined || !partial) {
    const r = normalizeShop(input.shop);
    if (r.error) return { error: `shop は${SHOP_MAX_LENGTH}文字以内で指定してください` };
    if (r.value === undefined || r.value === null) return { error: 'shop は必須です' };
    out.shop = r.value;
  }

  const order = normalizeOptionalText('order_id', input.order_id, ORDER_ID_MAX_LENGTH);
  if (order.error) return { error: order.error };

  const lineNo = normalizeInteger('line_no', input.line_no);
  if (lineNo.error) return { error: lineNo.error };

  const purchasedAt = normalizePurchasedAt(input.purchased_at);
  if (purchasedAt.error) return { error: '注文日は YYYY-MM-DD 形式で指定してください' };

  const code = normalizeOptionalText('code', input.code, CODE_MAX_LENGTH);
  if (code.error) return { error: code.error };

  // name: 必須
  let name;
  if (input.name !== undefined || !partial) {
    const r = normalizeOptionalText('name', input.name, NAME_MAX_LENGTH);
    if (r.error) return { error: r.error };
    if (r.value === undefined || r.value === null) return { error: 'name は必須です' };
    name = r.value;
  }

  const unitPrice = normalizeUnitPrice(input.unit_price);
  if (unitPrice.error) return { error: 'unit_price は0以上の数値で指定してください' };

  // currency: 未指定・null・'' は 'JPY'
  let currency;
  if (input.currency === undefined) {
    currency = partial ? undefined : DEFAULT_CURRENCY;
  } else if (input.currency === null) {
    currency = DEFAULT_CURRENCY;
  } else if (typeof input.currency !== 'string') {
    return { error: 'currency は3文字の英字（例: JPY, USD）で指定してください' };
  } else {
    const str = input.currency.trim().toUpperCase();
    if (str === '' || str === 'NULL') {
      currency = DEFAULT_CURRENCY;
    } else if (!/^[A-Z]{3}$/.test(str)) {
      return { error: 'currency は3文字の英字（例: JPY, USD）で指定してください' };
    } else {
      currency = str;
    }
  }

  const quantity = normalizeInteger('quantity', input.quantity);
  if (quantity.error) return { error: quantity.error };

  const partId = normalizeInteger('part_id', input.part_id, { min: 1 });
  if (partId.error) return { error: partId.error };

  const sourceMsgId = normalizeOptionalText('source_msg_id', input.source_msg_id, SOURCE_MSG_ID_MAX_LENGTH);
  if (sourceMsgId.error) return { error: sourceMsgId.error };

  const note = normalizeOptionalText('note', input.note, NOTE_MAX_LENGTH);
  if (note.error) return { error: note.error };

  const suggestedPartId = normalizeInteger('suggested_part_id', input.suggested_part_id, { min: 1 });
  if (suggestedPartId.error) return { error: suggestedPartId.error };

  const suggestionNote = normalizeOptionalText('suggestion_note', input.suggestion_note, SUGGESTION_NOTE_MAX_LENGTH);
  if (suggestionNote.error) return { error: suggestionNote.error };

  const candidates = {
    order_id: order.value,
    line_no: lineNo.value,
    purchased_at: purchasedAt.value,
    code: code.value,
    name,
    unit_price: unitPrice.value,
    currency,
    quantity: quantity.value,
    part_id: partId.value,
    source_msg_id: sourceMsgId.value,
    note: note.value,
    suggested_part_id: suggestedPartId.value,
    suggestion_note: suggestionNote.value
  };

  for (const field of FIELDS) {
    if (field === 'shop') continue;
    const v = candidates[field];
    if (v === undefined) {
      // 登録用は未送信を null にする（partial のときは含めない）
      if (!partial) out[field] = null;
    } else {
      out[field] = v;
    }
  }

  return { value: out };
}

/**
 * 重複判定用に name を正規化する（NFKC、空白の連続を 1 つに、trim、英字は小文字）
 *
 * @param {string} name
 * @returns {string}
 */
function normalizeNameForKey(name) {
  return String(name).normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * 重複判定キーを作る。shop は UNIQUE インデックスの 1 列目なのでキーには含めない
 *
 * - order_id あり、line_no あり: o:<order_id>|l:<line_no>
 * - order_id あり、line_no なし: o:<order_id>|n:<正規化 name>
 * - order_id なし、source_msg_id あり: m:<source_msg_id>|n:<正規化 name>
 *
 * @param {{ order_id?: string|null, line_no?: number|null, name: string, source_msg_id?: string|null }} record 正規化済みの値
 * @returns {{ value?: string, error?: string }}
 */
function buildDedupeKey({ order_id, line_no, name, source_msg_id }) {
  const hasOrderId = order_id !== undefined && order_id !== null && order_id !== '';
  const hasLineNo = line_no !== undefined && line_no !== null;
  const hasSourceMsgId = source_msg_id !== undefined && source_msg_id !== null && source_msg_id !== '';

  if (hasOrderId) {
    if (hasLineNo) return { value: `o:${order_id}|l:${line_no}` };
    return { value: `o:${order_id}|n:${normalizeNameForKey(name)}` };
  }
  if (hasSourceMsgId) {
    return { value: `m:${source_msg_id}|n:${normalizeNameForKey(name)}` };
  }
  return { error: 'order_id と source_msg_id のどちらかが必要です（重複判定に使います）' };
}

module.exports = {
  normalizePurchaseRecord,
  buildDedupeKey,
  normalizeNameForKey,
  FIELDS,
  KEY_FIELDS,
  DEFAULT_CURRENCY
};
