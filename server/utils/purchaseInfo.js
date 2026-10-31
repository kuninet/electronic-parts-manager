const SHOP_MAX_LENGTH = 100;
const UNIT_PRICE_MAX = 1e9;

/**
 * 購入先の正規化とバリデーションを行う
 * - 改行とタブは空白 1 つに置換し、前後空白は trim
 * - '', 'null', null は NULL (value: null)
 * - undefined は未送信として区別 (value: undefined)
 * - 最大 100 文字で、超えたらエラー
 *
 * @param {any} val
 * @returns {{ value?: string|null, error?: string }}
 */
function normalizeShop(val) {
  if (val === undefined) {
    return { value: undefined };
  }
  if (val === null) {
    return { value: null };
  }

  const str = String(val).replace(/[\r\n\t]+/g, ' ').trim();

  if (str === '' || str.toLowerCase() === 'null') {
    return { value: null };
  }

  if (str.length > SHOP_MAX_LENGTH) {
    return { error: `購入先は${SHOP_MAX_LENGTH}文字以内で入力してください` };
  }

  return { value: str };
}

/**
 * 購入日 (YYYY-MM-DD) の正規化とバリデーションを行う
 *
 * @param {any} val
 * @returns {{ value?: string|null, error?: string }}
 */
function normalizePurchasedAt(val) {
  if (val === undefined) {
    return { value: undefined };
  }
  if (val === null) {
    return { value: null };
  }

  const errorResult = { error: '購入日は YYYY-MM-DD 形式で指定してください' };
  if (typeof val !== 'string') {
    return errorResult;
  }

  const str = val.trim();
  if (str === '' || str.toLowerCase() === 'null') {
    return { value: null };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return errorResult;
  }

  const [y, m, d] = str.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  // 年が 0〜99 の場合 Date.UTC は 1900 年代に読み替えるため setUTCFullYear で補正する
  date.setUTCFullYear(y);
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return errorResult;
  }

  return { value: str };
}

/**
 * 単価の正規化とバリデーションを行う
 * 数値または数値文字列を受け付ける（FormData は文字列で届くため）
 *
 * @param {any} val
 * @returns {{ value?: number|null, error?: string }}
 */
function normalizeUnitPrice(val) {
  if (val === undefined) {
    return { value: undefined };
  }
  if (val === null) {
    return { value: null };
  }

  const errorResult = { error: '単価は0以上の数値で指定してください' };
  if (typeof val !== 'number' && typeof val !== 'string') {
    return errorResult;
  }

  if (typeof val === 'string') {
    const str = val.trim();
    if (str === '' || str.toLowerCase() === 'null') {
      return { value: null };
    }
    // '0x10' や '1e3' など Number() が解釈してしまう表記を拒否する
    if (!/^\d+(\.\d+)?$/.test(str)) {
      return errorResult;
    }
    val = str;
  }

  const num = Number(val);
  if (!Number.isFinite(num) || num < 0 || num > UNIT_PRICE_MAX) {
    return errorResult;
  }

  return { value: num };
}

/**
 * 購入情報 3 項目をまとめて検証する
 *
 * @param {Record<string, any>} body
 * @returns {{ values?: { shop: any, purchased_at: any, unit_price: any }, error?: string }}
 */
function normalizePurchaseInfo(body) {
  const src = body || {};
  const shop = normalizeShop(src.shop);
  if (shop.error) return { error: shop.error };
  const purchasedAt = normalizePurchasedAt(src.purchased_at);
  if (purchasedAt.error) return { error: purchasedAt.error };
  const unitPrice = normalizeUnitPrice(src.unit_price);
  if (unitPrice.error) return { error: unitPrice.error };

  return {
    values: {
      shop: shop.value,
      purchased_at: purchasedAt.value,
      unit_price: unitPrice.value
    }
  };
}

module.exports = {
  normalizeShop,
  normalizePurchasedAt,
  normalizeUnitPrice,
  normalizePurchaseInfo,
  SHOP_MAX_LENGTH
};
