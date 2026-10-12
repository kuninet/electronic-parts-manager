/**
 * QR「しまう」セッション状態管理（純粋関数群・DOM非依存）
 */

/**
 * @typedef {Object} StoreEntry
 * @property {string} key
 * @property {number|null} logId
 * @property {Object} part
 * @property {number} part.id
 * @property {string} part.name
 * @property {string|null} [part.part_number]
 * @property {number} [part.quantity]
 * @property {string|null} [part.image_path]
 * @property {number|null} previousLocationId
 * @property {string|null} previousLocationName
 * @property {'stored'|'undoing'|'undone'|'unchanged'|'error'} status
 * @property {{ message: string, retryable: boolean }|null} error
 * @property {string|null} restoredLocationName
 * @property {number} updatedAt
 */

/**
 * スキャン結果をセッション配列に追加または更新する（新しい配列を返す）
 * - 取り消していない同じ部品が既にある場合は、先頭に移す（件数は増えない）
 * - それ以外は新しいエントリを先頭に追加する
 *
 * @param {StoreEntry[]} entries
 * @param {{ part: Object, response: Object }} params
 * @returns {StoreEntry[]}
 */
export function addStoreResult(entries = [], { part, response } = {}) {
  if (!part || !response) return [...entries];

  const partId = part.id;
  const now = Date.now();
  const isUnchanged = Boolean(response.unchanged);

  // M-1: unchanged の場合のみ既存の未取り消しカードを先頭に移す（件数不変）
  if (isUnchanged) {
    const existingIndex = entries.findIndex(
      (e) => e.part && e.part.id === partId && e.status !== 'undone'
    );
    if (existingIndex !== -1) {
      const existing = entries[existingIndex];
      const updated = {
        ...existing,
        part: { ...existing.part, ...part },
        updatedAt: now
      };
      const next = [...entries];
      next.splice(existingIndex, 1);
      next.unshift(updated);
      return next;
    }
    // 未取り消しカードがなければ unchanged カードを新規作成
    const key = `part-${part.id}-${now}`;
    const newEntry = {
      key,
      logId: null,
      part: {
        id: part.id,
        name: part.name,
        part_number: part.part_number || null,
        quantity: part.quantity ?? 1,
        image_path: part.image_path || null
      },
      previousLocationId: response.previous_location_id ?? null,
      previousLocationName: response.previous_location_name ?? null,
      status: 'unchanged',
      error: null,
      restoredLocationName: null,
      updatedAt: now
    };
    return [newEntry, ...entries];
  }

  // M-1: 実際に格納された場合（unchanged: false）は、同じ部品の古い未取り消しエントリを外して新しいログIDで追加
  const filtered = entries.filter(
    (e) => !(e.part && e.part.id === partId && e.status !== 'undone')
  );

  const logId = response.log_id ?? null;
  const key = logId ? `log-${logId}` : `part-${part.id}-${now}`;

  const newEntry = {
    key,
    logId,
    part: {
      id: part.id,
      name: part.name,
      part_number: part.part_number || null,
      quantity: part.quantity ?? 1,
      image_path: part.image_path || null
    },
    previousLocationId: response.previous_location_id ?? null,
    previousLocationName: response.previous_location_name ?? null,
    status: 'stored',
    error: null,
    restoredLocationName: null,
    updatedAt: now
  };

  return [newEntry, ...filtered];
}

/**
 * エントリを取り消し中（undoing）にする
 * @param {StoreEntry[]} entries
 * @param {string} key
 * @returns {StoreEntry[]}
 */
export function markUndoing(entries = [], key) {
  return entries.map((e) => {
    if (e.key !== key) return e;
    return {
      ...e,
      status: 'undoing',
      error: null
    };
  });
}

/**
 * エントリを取り消し完了（undone）にする
 * @param {StoreEntry[]} entries
 * @param {string} key
 * @param {Object} [response]
 * @returns {StoreEntry[]}
 */
export function markUndone(entries = [], key, response = {}) {
  return entries.map((e) => {
    if (e.key !== key) return e;
    return {
      ...e,
      status: 'undone',
      restoredLocationName: response?.restored_location_name ?? null,
      error: null
    };
  });
}

/**
 * エントリを取り消し失敗（error）にする
 * @param {StoreEntry[]} entries
 * @param {string} key
 * @param {{ message?: string, retryable?: boolean }} err
 * @returns {StoreEntry[]}
 */
export function markUndoError(entries = [], key, { message, retryable } = {}) {
  return entries.map((e) => {
    if (e.key !== key) return e;
    return {
      ...e,
      status: 'error',
      error: {
        message: message || '取り消しに失敗しました',
        retryable: retryable !== false
      }
    };
  });
}

/**
 * 正常に格納された有効件数（status === 'stored'）を数える
 * @param {StoreEntry[]} entries
 * @returns {number}
 */
export function activeCount(entries = []) {
  return entries.filter((e) => e && e.status === 'stored').length;
}

/**
 * 同じQRの連続スキャンを無視すべきか判定する
 * @param {Object} params
 * @param {string} params.text
 * @param {string|null} [params.lastText]
 * @param {number|null} [params.lastAt]
 * @param {number} [params.now]
 * @param {number} [params.cooldownMs]
 * @returns {boolean}
 */
export function shouldIgnoreScan({
  text,
  lastText = null,
  lastAt = null,
  now = Date.now(),
  cooldownMs = 3000
} = {}) {
  if (!text || !lastText) return false;
  if (text !== lastText) return false;
  if (!lastAt) return false;
  return now - lastAt < cooldownMs;
}
