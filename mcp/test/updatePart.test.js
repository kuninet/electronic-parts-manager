const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { createMcpServer } = require('../server.js');
const { ApiError } = require('../apiClient.js');

describe('MCP update_part ツールテスト (UP-1 ~ UP-14)', () => {
    async function setup(mock = {}) {
        const calls = [];
        const apiClient = {
            apiUrl: 'http://localhost:3001',
            listParts: async () => [],
            getPart: async (id) => {
                calls.push(['getPart', id]);
                return { id, name: '更新後', shop: '秋月電子', purchased_at: '2026-03-01', unit_price: 30 };
            },
            listCategories: async () => [{ id: 1, name: '抵抗' }, { id: 2, name: 'LED' }],
            listLocations: async () => [{ id: 5, name: '引き出しA' }],
            patchPart: async (id, body) => {
                calls.push(['patchPart', id, body]);
                return { id };
            },
            changeQuantity: async (id, body) => {
                calls.push(['changeQuantity', id, body]);
                return { part_id: id, previous_quantity: 3, new_quantity: body.absolute, delta: body.absolute - 3, reason: body.reason ?? null };
            },
            storePart: async (body) => {
                calls.push(['storePart', body]);
                return { part_id: body.part_id, location_id: body.location_id, previous_location_id: null, previous_location_name: '箱B', unchanged: false, log_id: 1 };
            },
            ...mock,
        };
        const server = createMcpServer({ apiClient, version: '1.0.0' });
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await server.connect(serverTransport);
        const client = new Client({ name: 'test-client', version: '1.0.0' });
        await client.connect(clientTransport);
        return { client, calls };
    }

    const call = (client, args) => client.callTool({ name: 'update_part', arguments: args });
    const body = (res) => JSON.parse(res.content[0].text);

    test('UP-1: 項目のみの更新は patchPart だけが呼ばれ、null はそのまま送られる', async () => {
        const { client, calls } = await setup();
        const res = await call(client, { id: 1, shop: '秋月電子', unit_price: null });
        assert.ok(!res.isError);
        assert.deepEqual(calls[0], ['patchPart', 1, { shop: '秋月電子', unit_price: null }]);
        assert.equal(calls.filter(c => c[0] === 'changeQuantity' || c[0] === 'storePart').length, 0);
        const data = body(res);
        assert.equal(data.updated, true);
        assert.equal(data.part.unit_price, 30);
        assert.equal(data.part.purchased_at, '2026-03-01');
        assert.deepEqual(data.steps, { fields: ['shop', 'unit_price'], quantity: null, location: null });
    });

    test('UP-2: 数量のみの更新は changeQuantity に absolute と reason が渡り、patchPart は呼ばれない', async () => {
        const { client, calls } = await setup();
        const res = await call(client, { id: 1, quantity: 10, quantity_reason: '棚卸し' });
        assert.ok(!res.isError);
        assert.deepEqual(calls[0], ['changeQuantity', 1, { absolute: 10, reason: '棚卸し' }]);
        assert.equal(calls.filter(c => c[0] === 'patchPart').length, 0);
        const data = body(res);
        assert.deepEqual(data.steps.fields, []);
        assert.deepEqual(data.steps.quantity, { previous: 3, new: 10 });
    });

    test('UP-3: location_name が解決され storePart が memo: MCP で呼ばれる', async () => {
        const { client, calls } = await setup();
        const res = await call(client, { id: 1, location_name: '引き出しA' });
        assert.ok(!res.isError);
        assert.deepEqual(calls[0], ['storePart', { part_id: 1, location_id: 5, memo: 'MCP' }]);
        assert.deepEqual(body(res).steps.location, { previous_location_name: '箱B', unchanged: false });
    });

    test('UP-4: category_name が解決されて patchPart の category_id になり、category_id: null で未分類にできる', async () => {
        const { client, calls } = await setup();
        await call(client, { id: 1, category_name: 'led' });
        assert.deepEqual(calls[0], ['patchPart', 1, { category_id: 2 }]);
        await call(client, { id: 1, category_id: null });
        assert.deepEqual(calls[2], ['patchPart', 1, { category_id: null }]);
    });

    test('UP-5: 複合更新は項目 → 数量 → 保管場所の順に実行される', async () => {
        const { client, calls } = await setup();
        const res = await call(client, {
            id: 1, name: '新名称', tags: ['a', 'b'], quantity: 7, location_id: 5,
        });
        assert.ok(!res.isError);
        assert.deepEqual(calls.map(c => c[0]), ['patchPart', 'changeQuantity', 'storePart', 'getPart']);
        assert.deepEqual(calls[0][2], { name: '新名称', tags: ['a', 'b'] });
        const data = body(res);
        assert.deepEqual(data.steps.fields, ['name', 'tags']);
        assert.equal(data.steps.quantity.new, 7);
        assert.equal(data.steps.location.unchanged, false);
    });

    test('UP-5b: tags は trim・空要素除去・重複除去されて patchPart に渡り、空配列はそのまま渡る', async () => {
        const { client, calls } = await setup();
        await call(client, { id: 1, tags: ['a', ' a ', ' b', 'c '] });
        assert.deepEqual(calls[0], ['patchPart', 1, { tags: ['a', 'b', 'c'] }]);
        await call(client, { id: 1, tags: [] });
        assert.deepEqual(calls[2], ['patchPart', 1, { tags: [] }]);
    });

    test('UP-5c: 空白だけの tags はエラーで何も呼ばれない（意図しない全タグ削除を防ぐ）', async () => {
        const { client, calls } = await setup();
        const res = await call(client, { id: 1, shop: 'x', tags: ['  ', ' '] });
        assert.equal(res.isError, true);
        assert.match(res.content[0].text, /空配列 \[\]/);
        assert.equal(calls.length, 0);
    });

    test('UP-6: 更新項目が1つもなければエラーで何も呼ばれない', async () => {
        const { client, calls } = await setup();
        const res = await call(client, { id: 1 });
        assert.equal(res.isError, true);
        assert.match(res.content[0].text, /更新する項目を1つ以上指定してください/);
        assert.equal(calls.length, 0);
    });

    test('UP-7: category_id と category_name、location_id と location_name の同時指定はエラー', async () => {
        const { client, calls } = await setup();
        const r1 = await call(client, { id: 1, category_id: 1, category_name: '抵抗' });
        assert.equal(r1.isError, true);
        assert.match(r1.content[0].text, /category_id と category_name/);
        const r2 = await call(client, { id: 1, location_id: 5, location_name: '引き出しA' });
        assert.equal(r2.isError, true);
        assert.match(r2.content[0].text, /location_id と location_name/);
        assert.equal(calls.length, 0);
    });

    test('UP-8: quantity_reason だけの指定はエラー', async () => {
        const { client, calls } = await setup();
        const res = await call(client, { id: 1, shop: 'x', quantity_reason: '理由' });
        assert.equal(res.isError, true);
        assert.match(res.content[0].text, /quantity_reason/);
        assert.equal(calls.length, 0);
    });

    test('UP-9: 存在しない location_name は書き込み前にエラーとなり、項目更新も行われない', async () => {
        const { client, calls } = await setup();
        const res = await call(client, { id: 1, shop: 'x', location_name: '存在しない' });
        assert.equal(res.isError, true);
        assert.match(res.content[0].text, /保管場所「存在しない」は存在しません/);
        assert.equal(calls.length, 0);
    });

    test('UP-10: 数量の更新で失敗したら、完了済みの項目更新をメッセージに含める', async () => {
        const { client } = await setup({
            changeQuantity: async () => { throw new ApiError('not_found', 404, 'Part not found'); },
        });
        const res = await call(client, { id: 1, shop: 'x', unit_price: 5, quantity: 3 });
        assert.equal(res.isError, true);
        const text = res.content[0].text;
        assert.match(text, /項目（shop, unit_price）の更新は完了しましたが、数量の更新に失敗しました/);
        assert.match(text, /Part not found/);
    });

    test('UP-11: 保管場所の更新で失敗したら、完了済みの項目・数量の更新を含める', async () => {
        const { client } = await setup({
            storePart: async () => { throw new ApiError('http', 500, 'API エラー（500）'); },
        });
        const res = await call(client, { id: 1, name: 'n', quantity: 3, location_id: 5 });
        assert.equal(res.isError, true);
        assert.match(res.content[0].text, /項目（name）の更新と数量の更新は完了しましたが、保管場所の更新に失敗しました/);
    });

    test('UP-12: 最初の手順の失敗は「完了しました」を含まない', async () => {
        const { client } = await setup({
            patchPart: async () => { throw new ApiError('bad_request', 400, '不正なリクエストです: 購入日は YYYY-MM-DD 形式で指定してください'); },
        });
        const res = await call(client, { id: 1, purchased_at: '2026-02-30' });
        assert.equal(res.isError, true);
        assert.match(res.content[0].text, /項目の更新に失敗しました/);
        assert.doesNotMatch(res.content[0].text, /完了しました/);
    });

    test('UP-13: unknownOutcome のタイムアウトは「結果不明」と get_part_detail の案内を含む', async () => {
        const { client } = await setup({
            changeQuantity: async () => { throw new ApiError('timeout', null, 'タイムアウト', { unknownOutcome: true }); },
        });
        const res = await call(client, { id: 1, shop: 'x', quantity: 3 });
        assert.equal(res.isError, true);
        assert.match(res.content[0].text, /項目（shop）の更新は完了しましたが/);
        assert.match(res.content[0].text, /結果不明/);
        assert.match(res.content[0].text, /get_part_detail/);
    });

    test('UP-14: 最後の getPart が失敗しても updated: true で part を省き warning を付ける', async () => {
        const { client } = await setup({
            getPart: async () => { throw new ApiError('network', null, '接続できません'); },
        });
        const res = await call(client, { id: 1, shop: 'x' });
        assert.ok(!res.isError);
        const data = body(res);
        assert.equal(data.updated, true);
        assert.equal('part' in data, false);
        assert.ok(data.warning);
        assert.deepEqual(data.steps.fields, ['shop']);
    });

    test('UP-15: スキーマ違反（購入日形式・負の単価・空のタグ名・id なし）は isError', async () => {
        const { client, calls } = await setup();
        for (const args of [
            { id: 1, purchased_at: '2026/03/01' },
            { id: 1, unit_price: -1 },
            { id: 1, unit_price: 1e9 + 1 },
            { id: 1, tags: [''] },
            { shop: 'x' },
        ]) {
            const res = await call(client, args);
            assert.equal(res.isError, true, JSON.stringify(args));
        }
        assert.equal(calls.length, 0);
    });
});
