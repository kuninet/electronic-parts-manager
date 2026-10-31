const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
    toPartSummary,
    toPartDetail,
    toCategory,
    toLocation,
    toolResult,
    toolError,
} = require('../format.js');

describe('MCP Format Unit Tests (F-1 ~ F-9)', () => {
    const apiUrl = 'https://x.net';

    test('F-1: カンマ区切りタグの空白除去と空要素フィルタリング', () => {
        const part = {
            id: 1,
            name: 'LED',
            tags: 'LED, 赤,, ',
        };
        const summary = toPartSummary(part, apiUrl);
        assert.deepEqual(summary.tags, ['LED', '赤']);
    });

    test('F-2: tags が null の場合は空配列を返す', () => {
        const part = {
            id: 1,
            name: 'LED',
            tags: null,
        };
        const summary = toPartSummary(part, apiUrl);
        assert.deepEqual(summary.tags, []);
    });

    test('F-3: category_id と category_name のオブジェクト化、null時の処理', () => {
        const partWithCategory = {
            id: 1,
            name: '抵抗',
            category_id: 2,
            category_name: '受動部品',
        };
        const summary1 = toPartSummary(partWithCategory, apiUrl);
        assert.deepEqual(summary1.category, { id: 2, name: '受動部品' });

        const partWithoutCategory = {
            id: 2,
            name: '不明品',
            category_id: null,
            category_name: null,
        };
        const summary2 = toPartSummary(partWithoutCategory, apiUrl);
        assert.equal(summary2.category, null);
    });

    test('F-4: image_path の絶対 URL 解決と null 処理', () => {
        const partWithImage = {
            id: 1,
            name: 'IC',
            image_path: '/uploads/a.jpg',
        };
        const summary1 = toPartSummary(partWithImage, apiUrl);
        assert.equal(summary1.image_url, 'https://x.net/uploads/a.jpg');

        const partWithAbsoluteImage = {
            id: 2,
            name: 'IC2',
            image_path: 'https://cdn.example.com/b.jpg',
        };
        const summary2 = toPartSummary(partWithAbsoluteImage, apiUrl);
        assert.equal(summary2.image_url, 'https://cdn.example.com/b.jpg');

        const partWithoutImage = {
            id: 3,
            name: 'IC3',
            image_path: null,
        };
        const summary3 = toPartSummary(partWithoutImage, apiUrl);
        assert.equal(summary3.image_url, null);
    });

    test('F-5: 300文字の説明文は Summary では 200 文字 + …、Detail では全文を返す', () => {
        const longDesc = 'あ'.repeat(300);
        const part = {
            id: 1,
            name: '長い説明の部品',
            description: longDesc,
        };

        const summary = toPartSummary(part, apiUrl);
        assert.equal(summary.description.length, 201); // 200文字 + '…'
        assert.equal(summary.description, 'あ'.repeat(200) + '…');

        const detail = toPartDetail(part, apiUrl);
        assert.equal(detail.description.length, 300);
        assert.equal(detail.description, longDesc);
    });

    test('F-6: deleted_at, used_at に応じた status 判定（trash / used / active）', () => {
        const trashPart = {
            id: 1,
            name: '削除部品',
            deleted_at: '2026-01-01T00:00:00Z',
            used_at: '2026-01-01T00:00:00Z',
        };
        assert.equal(toPartDetail(trashPart, apiUrl).status, 'trash');

        const usedPart = {
            id: 2,
            name: '使用済部品',
            deleted_at: null,
            used_at: '2026-01-01T00:00:00Z',
        };
        assert.equal(toPartDetail(usedPart, apiUrl).status, 'used');

        const activePart = {
            id: 3,
            name: '有効部品',
            deleted_at: null,
            used_at: null,
        };
        assert.equal(toPartDetail(activePart, apiUrl).status, 'active');
    });

    test('F-7: 未知の列（datasheet_path など）は Summary に含まれない', () => {
        const partWithExtras = {
            id: 1,
            name: 'コンデンサ',
            part_number: 'C100',
            quantity: 10,
            description: 'テスト',
            category_id: 1,
            category_name: '受動',
            location_id: 2,
            location_name: '箱A',
            tags: 'test',
            image_path: '/uploads/c.jpg',
            deleted_at: null,
            used_at: null,
            datasheet_path: '/uploads/ds.pdf',
            unknown_internal_col: 12345,
        };

        const summary = toPartSummary(partWithExtras, apiUrl);
        const allowedKeys = [
            'id',
            'name',
            'part_number',
            'shop',
            'quantity',
            'description',
            'category',
            'location',
            'tags',
            'image_url',
            'status',
            'qr_code',
        ];
        assert.deepEqual(Object.keys(summary).sort(), allowedKeys.sort());
        assert.equal(summary.datasheet_path, undefined);
        assert.equal(summary.unknown_internal_col, undefined);
    });

    test('F-7b: shop は Summary に、purchased_at と unit_price は Detail に含まれ、未設定は null になる', () => {
        const part = {
            id: 1,
            name: '抵抗',
            shop: '秋月電子',
            purchased_at: '2026-03-01',
            unit_price: 0,
        };
        const summary = toPartSummary(part, apiUrl);
        assert.equal(summary.shop, '秋月電子');
        assert.equal('purchased_at' in summary, false);
        assert.equal('unit_price' in summary, false);

        const detail = toPartDetail(part, apiUrl);
        assert.equal(detail.shop, '秋月電子');
        assert.equal(detail.purchased_at, '2026-03-01');
        assert.equal(detail.unit_price, 0);

        const empty = toPartDetail({ id: 2, name: 'x' }, apiUrl);
        assert.equal(empty.shop, null);
        assert.equal(empty.purchased_at, null);
        assert.equal(empty.unit_price, null);
    });

    test('F-8: location の行は規定されたフィールドのみを持つ', () => {
        const rawLocation = {
            id: 3,
            name: '引き出しA',
            description: '抵抗保管場所',
            qr_code: 'L-0003',
            image_path: '/uploads/loc.jpg',
            display_order: 5,
            extra_field: 'should_not_exist',
        };

        const formatted = toLocation(rawLocation, apiUrl);
        const expectedKeys = [
            'id',
            'name',
            'description',
            'qr_code',
            'image_url',
            'display_order',
        ];
        assert.deepEqual(Object.keys(formatted).sort(), expectedKeys.sort());
        assert.equal(formatted.id, 3);
        assert.equal(formatted.name, '引き出しA');
        assert.equal(formatted.description, '抵抗保管場所');
        assert.equal(formatted.qr_code, 'L-0003');
        assert.equal(formatted.image_url, 'https://x.net/uploads/loc.jpg');
        assert.equal(formatted.display_order, 5);
        assert.equal(formatted.extra_field, undefined);
    });

    test('F-9: toPartSummary において qr_code が存在する場合は文字列、未定義・null の場合は null を返す', () => {
        const partWithQr = {
            id: 1,
            name: 'LED',
            qr_code: 'P-0001',
        };
        const summary1 = toPartSummary(partWithQr, apiUrl);
        assert.equal(summary1.qr_code, 'P-0001');

        const partWithNullQr = {
            id: 2,
            name: 'LED2',
            qr_code: null,
        };
        const summary2 = toPartSummary(partWithNullQr, apiUrl);
        assert.equal(summary2.qr_code, null);

        const partWithoutQr = {
            id: 3,
            name: 'LED3',
        };
        const summary3 = toPartSummary(partWithoutQr, apiUrl);
        assert.equal(summary3.qr_code, null);
    });

    test('toolResult と toolError のフォーマット検証', () => {
        const result = toolResult({ success: true, count: 1 });
        assert.deepEqual(result, {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({ success: true, count: 1 }, null, 2),
                },
            ],
        });

        const error = toolError('エラーメッセージ');
        assert.deepEqual(error, {
            isError: true,
            content: [
                {
                    type: 'text',
                    text: 'エラーメッセージ',
                },
            ],
        });
    });
});
