const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { resolveByName, normalizePartNumberKey } = require('../resolveMaster.js');

describe('MCP マスタ名前解決・型番正規化テスト (N-1 ~ N-8)', () => {
    test('N-1: 完全一致するマスタがあればその id を返す', () => {
        const items = [{ id: 1, name: '抵抗' }];
        const result = resolveByName(items, '抵抗');
        assert.deepEqual(result, { id: 1 });
    });

    test('N-2: 表記ゆれ（大文字小文字、全角半角、トリム）を吸収して完全一致解決する', () => {
        const items = [{ id: 1, name: 'LED' }];
        assert.deepEqual(resolveByName(items, 'led'), { id: 1 });
        assert.deepEqual(resolveByName(items, ' ＬＥＤ '), { id: 1 });
    });

    test('N-3: 同名（表記ゆれ含む）が複数存在する場合は ambiguous エラーと全 id を返す', () => {
        const items = [
            { id: 3, name: 'IC' },
            { id: 7, name: 'ic' },
        ];
        const result = resolveByName(items, 'IC');
        assert.deepEqual(result, { error: 'ambiguous', ids: [3, 7] });
    });

    test('N-4: 完全一致せず部分一致する場合は not_found かつ候補リストを返す', () => {
        const items = [
            { id: 1, name: '抵抗器' },
            { id: 2, name: '可変抵抗' },
        ];
        const result = resolveByName(items, '抵抗');
        assert.equal(result.error, 'not_found');
        assert.equal(result.candidates.length, 2);
        assert.deepEqual(result.candidates, items);
    });

    test('N-5: 部分一致候補が多数ある場合は最大 5 件に制限される', () => {
        const items = Array.from({ length: 8 }, (_, i) => ({
            id: i + 1,
            name: `抵抗器_${i + 1}`
        }));
        const result = resolveByName(items, '抵抗');
        assert.equal(result.error, 'not_found');
        assert.equal(result.candidates.length, 5);
    });

    test('N-6: アイテム一覧が空の場合は candidates: [] で not_found を返す', () => {
        const result = resolveByName([], 'LED');
        assert.deepEqual(result, { error: 'not_found', candidates: [] });
    });

    test('N-7: normalizePartNumberKey は NFKC・トリム・連続空白・大文字化を同一視する', () => {
        assert.equal(
            normalizePartNumberKey(' osr5ja '),
            normalizePartNumberKey('OSR5JA')
        );
        assert.equal(
            normalizePartNumberKey('2SC 1815'),
            normalizePartNumberKey('2SC  1815')
        );
        assert.equal(
            normalizePartNumberKey('２ＳＣ　１８１５'),
            normalizePartNumberKey('2SC 1815')
        );
    });

    test('N-8: normalizePartNumberKey は null, undefined, 空文字のとき null を返す', () => {
        assert.equal(normalizePartNumberKey(null), null);
        assert.equal(normalizePartNumberKey(undefined), null);
        assert.equal(normalizePartNumberKey(''), null);
        assert.equal(normalizePartNumberKey('   '), null);
    });
});
