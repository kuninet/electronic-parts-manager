// 購入明細を部品にひも付けたとき、部品側の購入情報（shop / purchased_at / unit_price）を
// 「最新の購入の要約」として更新する (#101)。
// 実際に値が変わる項目だけを UPDATE する。ゴミ箱の部品・存在しない部品は何もしない。

const NOW_SQL = "strftime('%Y-%m-%d %H:%M:%f','now')";

/**
 * @param {object} db getDb() のラッパー（get / run）
 * @param {{ shop?: string|null, purchased_at?: string|null, unit_price?: number|null, currency?: string|null }} record
 * @param {number} partId
 * @returns {Promise<{ part_id: number, fields: Record<string, any> } | null>}
 */
async function applyPurchaseToPart(db, record, partId) {
  const part = await db.get(
    'SELECT id, shop, purchased_at, unit_price FROM parts WHERE id = ? AND deleted_at IS NULL',
    [partId]
  );
  if (!part) return null;

  // 単価は JPY のときだけ反映する（外貨は換算しない）
  const priceUsable = record.currency === 'JPY' && record.unit_price !== null && record.unit_price !== undefined;
  const hasShop = typeof record.shop === 'string' && record.shop !== '';
  const fields = {};

  if (record.purchased_at) {
    // 部品側が空、または明細の日付が同じかそれより新しいときだけ上書きする
    if (!part.purchased_at || record.purchased_at >= part.purchased_at) {
      if (hasShop && record.shop !== part.shop) fields.shop = record.shop;
      if (record.purchased_at !== part.purchased_at) fields.purchased_at = record.purchased_at;
      if (priceUsable && record.unit_price !== part.unit_price) fields.unit_price = record.unit_price;
    }
  } else {
    // 注文日がない明細は、部品側の空欄だけを埋める
    if (hasShop && (part.shop === null || part.shop === '')) fields.shop = record.shop;
    if (priceUsable && part.unit_price === null) fields.unit_price = record.unit_price;
  }

  const cols = Object.keys(fields);
  if (cols.length === 0) return null;

  await db.run(
    `UPDATE parts SET ${cols.map(c => `${c} = ?`).join(', ')}, updated_at = ${NOW_SQL} WHERE id = ?`,
    [...cols.map(c => fields[c]), partId]
  );
  return { part_id: partId, fields };
}

module.exports = { applyPurchaseToPart };
