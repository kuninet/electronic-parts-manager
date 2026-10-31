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

/**
 * マスタ名を ID に解決し、失敗時は AI 向けのエラーメッセージを返す共通処理
 *
 * @param {Array<{ id: number, name: string }>} items
 * @param {string} name
 * @param {string} label 表示名（「カテゴリ」「保管場所」）
 * @param {string} idParam ID 指定時の引数名（category_id など）
 * @returns {{ id: number } | { error: string }}
 */
function resolveMasterId(items, name, label, idParam) {
    const resolved = resolveByName(items, name);
    if (resolved.error === 'ambiguous') {
        return { error: `${label}名「${name}」が複数あります（id: ${resolved.ids.join(', ')}）。${idParam} で指定してください。` };
    }
    if (resolved.error === 'not_found') {
        const candStr = resolved.candidates.length > 0
            ? `既存の候補: [${resolved.candidates.map(c => `${c.name} (id: ${c.id})`).join(', ')}]。`
            : '';
        return { error: `${label}「${name}」は存在しません。${candStr}list_master_data で一覧を確認してください。` };
    }
    return { id: resolved.id };
}

/**
 * カテゴリ名を ID に解決する
 *
 * @param {{ listCategories: () => Promise<Array<{ id: number, name: string }>> }} apiClient
 * @param {string} name
 * @returns {Promise<{ id: number } | { error: string }>}
 */
async function resolveCategoryId(apiClient, name) {
    const categories = await apiClient.listCategories();
    return resolveMasterId(categories, name, 'カテゴリ', 'category_id');
}

/**
 * 保管場所名を ID に解決する
 *
 * @param {{ listLocations: () => Promise<Array<{ id: number, name: string }>> }} apiClient
 * @param {string} name
 * @returns {Promise<{ id: number } | { error: string }>}
 */
async function resolveLocationId(apiClient, name) {
    const locations = await apiClient.listLocations();
    return resolveMasterId(locations, name, '保管場所', 'location_id');
}

module.exports = {
    resolveByName,
    resolveCategoryId,
    resolveLocationId,
    normalizePartNumberKey,
};
