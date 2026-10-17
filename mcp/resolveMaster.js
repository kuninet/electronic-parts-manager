/**
 * マスタ名前解決および型番正規化モジュール
 * カテゴリや保管場所の名前解決（完全一致・表記ゆれ吸収・曖昧エラー判定）と型番キー正規化を提供します。
 */

/**
 * 文字列を正規化キーに変換する（NFKC正規化、トリム、小文字化）
 * @param {string} str
 * @returns {string}
 */
function normalizeKey(str) {
    if (typeof str !== 'string') return '';
    return str.normalize('NFKC').trim().toLowerCase();
}

/**
 * マスタデータ一覧（items）から指定された名前（name）を解決する純関数
 * 
 * @param {Array<{ id: number, name: string }>} items マスタアイテム配列
 * @param {string} name 解決対象の名前
 * @returns {{ id: number } | { error: 'ambiguous', ids: number[] } | { error: 'not_found', candidates: Array<{ id: number, name: string }> }}
 */
function resolveByName(items, name) {
    if (!Array.isArray(items) || typeof name !== 'string') {
        return { error: 'not_found', candidates: [] };
    }

    const queryKey = normalizeKey(name);
    if (!queryKey) {
        return { error: 'not_found', candidates: [] };
    }

    // 1. 完全一致（正規化キー一致）を探す
    const exactMatches = [];
    const partialMatches = [];

    for (const item of items) {
        if (!item || typeof item.name !== 'string') continue;
        const itemKey = normalizeKey(item.name);
        if (itemKey === queryKey) {
            exactMatches.push(item);
        } else if (itemKey.includes(queryKey)) {
            partialMatches.push(item);
        }
    }

    if (exactMatches.length === 1) {
        return { id: exactMatches[0].id };
    }

    if (exactMatches.length > 1) {
        return {
            error: 'ambiguous',
            ids: exactMatches.map(m => m.id)
        };
    }

    // 完全一致が 0 件の場合
    return {
        error: 'not_found',
        candidates: partialMatches.slice(0, 5)
    };
}

/**
 * 型番比較用キーの正規化（NFKC正規化、トリム、大文字化、連続空白の圧縮）
 * 重複確認を行わない場合（空文字や null）は null を返す
 * 
 * @param {string | null | undefined} raw
 * @returns {string | null}
 */
function normalizePartNumberKey(raw) {
    if (raw === null || raw === undefined || typeof raw !== 'string') {
        return null;
    }
    const normalized = raw.normalize('NFKC').trim();
    if (!normalized) {
        return null;
    }
    return normalized.replace(/\s+/g, ' ').toUpperCase();
}

module.exports = {
    resolveByName,
    normalizePartNumberKey,
};
