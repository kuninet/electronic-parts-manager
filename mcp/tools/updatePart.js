/**
 * update_part ツール実装
 * 既存の電子部品の項目を汎用的に更新します。
 * 項目の更新は PATCH、数量と保管場所は専用 API（ログが残る）を内部で呼びます。
 */

const { z } = require('zod');
const { toPartDetail, toolResult, toolError } = require('../format.js');
const { resolveCategoryId, resolveLocationId } = require('../resolveMaster.js');
const { ApiError } = require('../apiClient.js');

const updatePartSchema = {
    id: z.number().int().positive(),
    name: z.string().min(1).max(200).optional(),
    part_number: z.string().max(100).nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
    category_id: z.number().int().positive().nullable().optional(),
    category_name: z.string().max(100).optional(),
    datasheet_url: z.string().max(2000).nullable().optional(),
    shop: z.string().max(100).nullable().optional(),
    purchased_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    unit_price: z.number().min(0).max(1e9).nullable().optional(),
    tags: z.array(z.string().min(1).max(100)).max(50).optional(),
    quantity: z.number().int().min(0).optional(),
    quantity_reason: z.string().max(200).optional(),
    location_id: z.number().int().positive().optional(),
    location_name: z.string().max(100).optional(),
};

// PATCH /api/parts/:id にそのまま渡せる項目（category は解決後の category_id で渡す）
const PATCH_FIELDS = [
    'name', 'part_number', 'description', 'category_id', 'datasheet_url',
    'shop', 'purchased_at', 'unit_price', 'tags',
];

/**
 * 完了済みの手順を説明する文を作ります。
 *
 * @param {{ fields: string[], quantity: object | null }} done
 * @returns {string}
 */
function describeDone(done) {
    const parts = [];
    if (done.fields.length > 0) parts.push(`項目（${done.fields.join(', ')}）の更新`);
    if (done.quantity) parts.push('数量の更新');
    return parts.length > 0 ? `${parts.join('と')}は完了しましたが、` : '';
}

/**
 * McpServer に update_part ツールを登録します。
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ apiClient: object, apiUrl: string }} options
 */
function registerUpdatePartTool(server, { apiClient, apiUrl }) {
    server.registerTool(
        'update_part',
        {
            title: '電子部品更新',
            description:
                '既存の電子部品の名前・型番・説明・カテゴリ・データシートURL・購入先・購入日（YYYY-MM-DD）・単価・タグ・数量・保管場所を更新します。' +
                '指定しない項目は変更しません。型番・説明・カテゴリ・データシートURL・購入先・購入日・単価は null を指定すると消去できます。' +
                'tags は全置換です（指定した配列が新しいタグの全体になります。空配列で全タグを外します）。' +
                '数量（quantity は更新後の絶対値）と保管場所は専用処理で更新され、入出庫ログが記録されます。保管場所の消去はできません。' +
                '画像・QRコード・使用済み・ゴミ箱の操作はできません。' +
                '実行するとデータが変更されます。',
            annotations: {
                readOnlyHint: false,
                idempotentHint: false,
                openWorldHint: false,
                destructiveHint: false,
            },
            inputSchema: updatePartSchema,
        },
        async (args) => {
            // 完了した手順（失敗時のメッセージに含める）
            const done = { fields: [], quantity: null, location: null };
            let currentStep = '部品の更新';

            try {
                // 1. 検証（書き込み前にすべて済ませる）
                const hasFieldUpdate = PATCH_FIELDS.some((f) => args[f] !== undefined)
                    || args.category_name !== undefined;
                const hasQuantity = args.quantity !== undefined;
                const hasLocation = args.location_id !== undefined || args.location_name !== undefined;

                if (!hasFieldUpdate && !hasQuantity && !hasLocation) {
                    return toolError('更新する項目を1つ以上指定してください');
                }
                if (args.category_id !== undefined && args.category_name !== undefined) {
                    return toolError('category_id と category_name はどちらか一方だけ指定してください');
                }
                if (args.location_id !== undefined && args.location_name !== undefined) {
                    return toolError('location_id と location_name はどちらか一方だけ指定してください');
                }
                if (args.quantity_reason !== undefined && !hasQuantity) {
                    return toolError('quantity_reason は quantity と一緒に指定してください');
                }
                // 空白だけのタグで意図せず全タグを外さないようにする（全削除は空配列で明示する）
                if (args.tags !== undefined && args.tags.length > 0 && args.tags.every(t => t.trim() === '')) {
                    return toolError('tags に空白だけの要素しかありません。タグをすべて外す場合は空配列 [] を指定してください');
                }

                let resolvedCategoryId = args.category_id;
                if (args.category_name !== undefined) {
                    const resolved = await resolveCategoryId(apiClient, args.category_name);
                    if (resolved.error) return toolError(resolved.error);
                    resolvedCategoryId = resolved.id;
                }

                let resolvedLocationId = args.location_id;
                if (args.location_name !== undefined) {
                    const resolved = await resolveLocationId(apiClient, args.location_name);
                    if (resolved.error) return toolError(resolved.error);
                    resolvedLocationId = resolved.id;
                }

                // 2. 項目の更新（PATCH）
                const payload = {};
                for (const f of PATCH_FIELDS) {
                    if (args[f] !== undefined) payload[f] = args[f];
                }
                if (resolvedCategoryId !== undefined) payload.category_id = resolvedCategoryId;
                if (args.tags !== undefined) {
                    // 前後空白の除去・空要素除去・重複除去（空配列はそのまま全タグ削除になる）
                    payload.tags = [...new Set(args.tags.map(t => t.trim()).filter(Boolean))];
                }

                if (Object.keys(payload).length > 0) {
                    currentStep = '項目の更新';
                    await apiClient.patchPart(args.id, payload);
                    done.fields = Object.keys(payload);
                }

                // 3. 数量の更新（専用 API・ログが残る）
                if (hasQuantity) {
                    currentStep = '数量の更新';
                    const qtyPayload = { absolute: args.quantity };
                    if (args.quantity_reason !== undefined) qtyPayload.reason = args.quantity_reason;
                    const res = await apiClient.changeQuantity(args.id, qtyPayload);
                    done.quantity = {
                        previous: res.previous_quantity ?? null,
                        new: res.new_quantity ?? args.quantity,
                    };
                }

                // 4. 保管場所の更新（専用 API・ログが残る）
                if (hasLocation) {
                    currentStep = '保管場所の更新';
                    const res = await apiClient.storePart({
                        part_id: args.id,
                        location_id: resolvedLocationId,
                        memo: 'MCP',
                    });
                    done.location = {
                        previous_location_name: res.previous_location_name ?? null,
                        unchanged: !!res.unchanged,
                    };
                }

                const steps = {
                    fields: done.fields,
                    quantity: done.quantity,
                    location: done.location,
                };

                // 5. 更新後の詳細取得
                try {
                    const detail = await apiClient.getPart(args.id);
                    return toolResult({
                        updated: true,
                        part: toPartDetail(detail, apiUrl),
                        steps,
                    });
                } catch {
                    return toolResult({
                        updated: true,
                        steps,
                        warning: '更新済みですが詳細の取得に失敗しました',
                    });
                }
            } catch (err) {
                const prefix = describeDone(done);
                if (err instanceof ApiError && err.unknownOutcome) {
                    return toolError(
                        `${prefix}${currentStep}の結果不明です。リクエストがタイムアウトしたため、反映されたか確認できません。` +
                        `get_part_detail で反映を確認してから再実行してください: ${err.message}`
                    );
                }
                const detail = err.message || '不明なエラー';
                if (prefix) {
                    return toolError(`${prefix}${currentStep}に失敗しました: ${detail}`);
                }
                return toolError(`${currentStep}に失敗しました: ${detail}`);
            }
        }
    );
}

module.exports = {
    updatePartSchema,
    registerUpdatePartTool,
};
