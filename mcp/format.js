/**
 * MCP データフォーマットモジュール
 * REST API のレスポンスを MCP ツール出力形式に整形する純関数群を提供します。
 */

/**
 * 画像パスを絶対 URL に変換します。
 *
 * @param {string | null} imagePath 画像パス（相対パスまたは絶対URL）
 * @param {string} apiUrl EPM API のベース URL
 * @returns {string | null}
 */
function formatImageUrl(imagePath, apiUrl) {
    if (!imagePath) return null;
    if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
        return imagePath;
    }
    try {
        const resolved = imagePath.startsWith('/') ? imagePath : `/${imagePath}`;
        return new URL(resolved, apiUrl).href;
    } catch {
        return null;
    }
}

/**
 * カンマ区切りのタグ文字列または配列を文字列配列に正規化します。
 *
 * @param {string | string[] | null | undefined} tags
 * @returns {string[]}
 */
function parseTags(tags) {
    if (!tags) return [];
    if (Array.isArray(tags)) {
        return tags.map((t) => String(t).trim()).filter(Boolean);
    }
    if (typeof tags === 'string') {
        return tags.split(',').map((t) => t.trim()).filter(Boolean);
    }
    return [];
}

/**
 * 削除日時・使用日時からステータス文字列を決定します。
 *
 * @param {{ deleted_at?: string | null, used_at?: string | null }} row
 * @returns {'trash' | 'used' | 'active'}
 */
function resolveStatus(row) {
    if (row.deleted_at) return 'trash';
    if (row.used_at) return 'used';
    return 'active';
}

/**
 * 説明文を最大200文字に切り詰めます。
 *
 * @param {string | null | undefined} desc
 * @returns {string | null}
 */
function truncateDescription(desc) {
    if (desc === null || desc === undefined) return null;
    const str = String(desc);
    if (str.length > 200) {
        return str.slice(0, 200) + '…';
    }
    return str;
}

/**
 * 部品データを一覧用のサマリー形式に整形します。
 *
 * @param {Record<string, any>} part
 * @param {string} apiUrl
 * @returns {object}
 */
function toPartSummary(part, apiUrl) {
    const category = (part.category_id !== null && part.category_id !== undefined)
        ? { id: part.category_id, name: part.category_name ?? null }
        : null;

    const location = (part.location_id !== null && part.location_id !== undefined)
        ? { id: part.location_id, name: part.location_name ?? null }
        : null;

    return {
        id: part.id,
        name: part.name,
        part_number: part.part_number !== undefined ? part.part_number : null,
        shop: part.shop ?? null,
        quantity: part.quantity !== undefined ? part.quantity : null,
        description: truncateDescription(part.description),
        category,
        location,
        tags: parseTags(part.tags),
        image_url: formatImageUrl(part.image_path, apiUrl),
        status: resolveStatus(part),
        qr_code: part.qr_code ?? null,
    };
}

/**
 * 部品データを詳細形式に整形します（説明文は全文）。
 *
 * @param {Record<string, any>} part
 * @param {string} apiUrl
 * @returns {object}
 */
function toPartDetail(part, apiUrl) {
    const summary = toPartSummary(part, apiUrl);

    return {
        ...summary,
        description: part.description !== undefined ? part.description : null,
        datasheet_url: part.datasheet_url ?? null,
        purchased_at: part.purchased_at ?? null,
        unit_price: part.unit_price ?? null,
        used_at: part.used_at ?? null,
        used_for: part.used_for ?? null,
        used_note: part.used_note ?? null,
        deleted_at: part.deleted_at ?? null,
        created_at: part.created_at ?? null,
        updated_at: part.updated_at ?? null,
    };
}

/**
 * カテゴリデータを整形します。
 *
 * @param {Record<string, any>} category
 * @returns {object}
 */
function toCategory(category) {
    return {
        id: category.id,
        name: category.name,
        display_order: category.display_order ?? 0,
    };
}

/**
 * 保管場所データを整形します。
 *
 * @param {Record<string, any>} location
 * @param {string} apiUrl
 * @returns {object}
 */
function toLocation(location, apiUrl) {
    return {
        id: location.id,
        name: location.name,
        description: location.description ?? null,
        qr_code: location.qr_code ?? null,
        image_url: formatImageUrl(location.image_path, apiUrl),
        display_order: location.display_order ?? 0,
    };
}

/**
 * 購入明細を MCP 出力形式に整形します（dedupe_key、created_at、updated_at は出さない）。
 *
 * @param {Record<string, any>} row
 * @returns {object}
 */
function toPurchaseRecord(row) {
    const part = (row.part_id !== null && row.part_id !== undefined)
        ? { id: row.part_id, name: row.part_name ?? null }
        : null;

    return {
        id: row.id,
        shop: row.shop,
        order_id: row.order_id ?? null,
        line_no: row.line_no ?? null,
        purchased_at: row.purchased_at ?? null,
        code: row.code ?? null,
        name: row.name,
        unit_price: row.unit_price ?? null,
        currency: row.currency ?? null,
        quantity: row.quantity ?? null,
        part,
        source_msg_id: row.source_msg_id ?? null,
        note: row.note ?? null,
        import_batch_id: row.import_batch_id ?? null,
    };
}

/**
 * 取り込みバッチを MCP 出力形式に整形します。
 *
 * @param {Record<string, any>} row
 * @returns {object}
 */
function toImportBatch(row) {
    return {
        id: row.id,
        source: row.source ?? null,
        note: row.note ?? null,
        on_duplicate: row.on_duplicate ?? null,
        total: row.total ?? 0,
        created: row.created_count ?? 0,
        updated: row.updated_count ?? 0,
        skipped: row.skipped_count ?? 0,
        errors: row.error_count ?? 0,
        created_at: row.created_at ?? null,
        undone_at: row.undone_at ?? null,
    };
}

/**
 * ツール成功結果オブジェクトを生成します。
 *
 * @param {any} data
 * @returns {{ content: Array<{ type: 'text', text: string }> }}
 */
function toolResult(data) {
    return {
        content: [
            {
                type: 'text',
                text: JSON.stringify(data, null, 2),
            },
        ],
    };
}

/**
 * ツールエラー結果オブジェクトを生成します。
 *
 * @param {string} message
 * @returns {{ isError: true, content: Array<{ type: 'text', text: string }> }}
 */
function toolError(message) {
    return {
        isError: true,
        content: [
            {
                type: 'text',
                text: message,
            },
        ],
    };
}

module.exports = {
    formatImageUrl,
    parseTags,
    resolveStatus,
    truncateDescription,
    toPartSummary,
    toPartDetail,
    toCategory,
    toLocation,
    toPurchaseRecord,
    toImportBatch,
    toolResult,
    toolError,
};
