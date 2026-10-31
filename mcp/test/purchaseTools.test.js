const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { createMcpServer } = require('../server.js');
const { ApiError } = require('../apiClient.js');

describe('MCP 購入履歴ツールテスト (PT-1 ~ PT-24)', () => {
    const item = (over = {}) => ({
        id: 1,
        shop: '秋月電子通商',
        order_id: 'A-1',
        line_no: 1,
        purchased_at: '2026-03-01',
        code: 'I-001',
        name: 'LED',
        unit_price: 10,
        currency: 'JPY',
        quantity: 5,
        part_id: null,
        part_name: null,
        source_msg_id: null,
        note: null,
        dedupe_key: 'o:A-1|l:1',
        created_at: '2026-03-02 00:00:00',
        updated_at: '2026-03-02 00:00:00',
        ...over,
    });

    async function setup(mock = {}, { readOnly = false } = {}) {
        const calls = [];
        const apiClient = {
            apiUrl: 'http://localhost:3001',
            listPurchases: async (q) => {
                calls.push(['listPurchases', q]);
                return { total: 1, items: [item()] };
            },
            importPurchases: async (b) => {
                calls.push(['importPurchases', b]);
                return {
                    total: b.records.length, created: b.records.length, updated: 0, skipped: 0, errors: 0,
                    results: b.records.map((_, index) => ({ index, status: 'created', id: 100 + index })),
                };
            },
            patchPurchase: async (id, b) => {
                calls.push(['patchPurchase', id, b]);
                return item({ id, ...b, part_name: b.part_id ? '高輝度LED' : null });
            },
            ...mock,
        };
        const server = createMcpServer({ apiClient, version: '1.0.0', readOnly });
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await server.connect(serverTransport);
        const client = new Client({ name: 'test-client', version: '1.0.0' });
        await client.connect(clientTransport);
        return { client, calls };
    }

    const call = (client, name, args) => client.callTool({ name, arguments: args });
    const body = (res) => JSON.parse(res.content[0].text);

    test('PT-1: search_purchase_items は query を search に変え、linked: false を渡し、dedupe_key を出さない', async () => {
        const { client, calls } = await setup();
        const res = await call(client, 'search_purchase_items', { query: ' LED ', linked: false, from: '2026-01-01', shop: '秋月電子通商' });
        assert.ok(!res.isError);
        assert.deepEqual(calls[0], ['listPurchases', {
            search: 'LED',
            shop: '秋月電子通商',
            order_id: undefined,
            part_id: undefined,
            linked: false,
            from: '2026-01-01',
            to: undefined,
            currency: undefined,
            limit: 50,
            offset: 0,
        }]);
        const data = body(res);
        assert.equal(data.total, 1);
        assert.equal(data.returned, 1);
        assert.equal(data.offset, 0);
        assert.equal(data.truncated, false);
        assert.equal(data.hint, undefined);
        assert.equal(data.items[0].name, 'LED');
        assert.equal(data.items[0].part, null);
        assert.equal('dedupe_key' in data.items[0], false);
        assert.equal('created_at' in data.items[0], false);
        assert.equal('updated_at' in data.items[0], false);
    });

    test('PT-2: search_purchase_items は件数が多いとき truncated と hint（次の offset）を返す', async () => {
        const { client } = await setup({
            listPurchases: async () => ({ total: 120, items: [item({ id: 11 }), item({ id: 12 })] }),
        });
        const res = await call(client, 'search_purchase_items', { limit: 2, offset: 10 });
        const data = body(res);
        assert.equal(data.total, 120);
        assert.equal(data.returned, 2);
        assert.equal(data.offset, 10);
        assert.equal(data.truncated, true);
        assert.match(data.hint, /offset: 12/);
    });

    test('PT-3: search_purchase_items は part_id のある明細に part を付け、最後のページは truncated: false', async () => {
        const { client } = await setup({
            listPurchases: async () => ({ total: 3, items: [item({ id: 3, part_id: 5, part_name: '高輝度LED' })] }),
        });
        const data = body(await call(client, 'search_purchase_items', { limit: 10, offset: 2 }));
        assert.deepEqual(data.items[0].part, { id: 5, name: '高輝度LED' });
        assert.equal(data.truncated, false);
    });

    test('PT-4: search_purchase_items の API エラーは isError', async () => {
        const { client } = await setup({
            listPurchases: async () => { throw new ApiError('bad_request', 400, '不正なリクエストです: from は YYYY-MM-DD 形式で指定してください'); },
        });
        const res = await call(client, 'search_purchase_items', {});
        assert.equal(res.isError, true);
        assert.match(res.content[0].text, /from/);
    });

    test('PT-5: search_purchase_items のスキーマ違反（日付形式・limit 範囲・offset 負）は isError で API を呼ばない', async () => {
        const { client, calls } = await setup();
        for (const args of [{ from: '2026/03/01' }, { to: 'abc' }, { limit: 101 }, { limit: 0 }, { offset: -1 }, { part_id: 0 }]) {
            const res = await call(client, 'search_purchase_items', args);
            assert.equal(res.isError, true, JSON.stringify(args));
        }
        assert.equal(calls.length, 0);
    });

    test('PT-6: search_purchase_items の説明に linked: false と search_parts が書かれている', async () => {
        const { client } = await setup();
        const { tools } = await client.listTools();
        const tool = tools.find((t) => t.name === 'search_purchase_items');
        assert.match(tool.description, /linked: false/);
        assert.match(tool.description, /search_parts/);
        assert.equal(tool.annotations.readOnlyHint, true);
    });

    test('PT-7: readOnly では search_purchase_items だけが登録される', async () => {
        const { client } = await setup({}, { readOnly: true });
        const names = (await client.listTools()).tools.map((t) => t.name);
        assert.ok(names.includes('search_purchase_items'));
        assert.ok(!names.includes('import_purchase_items'));
        assert.ok(!names.includes('update_purchase_item'));
    });

    test('PT-10: import_purchase_items は records と on_duplicate（既定 skip）を渡し、created の id を ids にまとめる', async () => {
        const { client, calls } = await setup();
        const records = [
            { shop: '秋月電子通商', order_id: 'A-1', line_no: 1, name: 'LED' },
            { shop: '秋月電子通商', order_id: 'A-1', line_no: 2, name: '抵抗', unit_price: 1.5, currency: 'JPY' },
        ];
        const res = await call(client, 'import_purchase_items', { records });
        assert.ok(!res.isError);
        assert.deepEqual(calls[0], ['importPurchases', { records, on_duplicate: 'skip' }]);
        assert.deepEqual(body(res), {
            total: 2, created: 2, updated: 0, skipped: 0, errors: 0,
            ids: [100, 101],
            results: [],
        });
    });

    test('PT-11: import_purchase_items は error と warning の明細だけ results に返し、updated の id も ids に入る', async () => {
        const { client, calls } = await setup({
            importPurchases: async () => ({
                total: 4, created: 1, updated: 1, skipped: 0, errors: 1,
                results: [
                    { index: 0, status: 'created', id: 10, warning: 'part_id 999 の部品が見つからないため、ひも付けずに登録しました' },
                    { index: 1, status: 'updated', id: 11 },
                    { index: 2, status: 'error', error: 'unit_price は0以上の数値で指定してください' },
                    { index: 3, status: 'skipped', id: 12 },
                ],
            }),
        });
        const res = await call(client, 'import_purchase_items', {
            records: [{ shop: 'S', name: 'x' }],
            on_duplicate: 'update',
        });
        assert.equal(calls.length, 0);
        const data = body(res);
        assert.deepEqual(data.ids, [10, 11]);
        assert.equal(data.errors, 1);
        assert.deepEqual(data.results.map((r) => r.index), [0, 2]);
        assert.match(data.results[0].warning, /part_id 999/);
        assert.match(data.results[1].error, /unit_price/);
    });

    test('PT-12: import_purchase_items のスキーマ違反（0件・501件・on_duplicate 不正・records なし）は isError で API を呼ばない', async () => {
        const { client, calls } = await setup();
        const one = { shop: 'S', name: 'x', order_id: '1' };
        for (const args of [
            { records: [] },
            { records: Array.from({ length: 501 }, () => one) },
            { records: [one], on_duplicate: 'replace' },
            {},
        ]) {
            const res = await call(client, 'import_purchase_items', args);
            assert.equal(res.isError, true, JSON.stringify(args).slice(0, 80));
        }
        assert.equal(calls.length, 0);
    });

    test('PT-12b: 不正な明細（shop なし・型違い・未知の項目）を含んでいても API が呼ばれ、その明細だけがエラーで返る', async () => {
        const { client, calls } = await setup({
            importPurchases: async (b) => {
                calls.push(['importPurchases', b]);
                return {
                    total: 3, created: 1, updated: 0, skipped: 0, errors: 2,
                    results: [
                        { index: 0, status: 'created', id: 5 },
                        { index: 1, status: 'error', error: 'shop は必須です' },
                        { index: 2, status: 'error', error: 'unit_price は0以上の数値で指定してください' },
                    ],
                };
            },
        });
        const records = [
            { shop: 'S', name: 'ok', order_id: '1', line_no: 1 },
            { name: 'shopなし', order_id: '1', line_no: 2 },
            { shop: 'S', name: '型違い', order_id: '1', line_no: 3, unit_price: '安い', extra: 'x' },
        ];
        const res = await call(client, 'import_purchase_items', { records });
        assert.ok(!res.isError);
        assert.equal(calls.length, 1);
        assert.deepEqual(calls[0][1].records, records);
        const data = body(res);
        assert.equal(data.errors, 2);
        assert.deepEqual(data.ids, [5]);
        assert.deepEqual(data.results.map((r) => r.index), [1, 2]);
        assert.match(data.results[0].error, /shop/);
    });

    test('PT-12c: 同じリクエスト内の重複 warning は results に含まれて返る', async () => {
        const warning = '同じリクエストの index 0 と同じ明細とみなしました（数量や単価が違う場合は line_no を付けてください）';
        const { client } = await setup({
            importPurchases: async () => ({
                total: 2, created: 1, updated: 0, skipped: 1, errors: 0,
                results: [
                    { index: 0, status: 'created', id: 1 },
                    { index: 1, status: 'skipped', id: 1, warning },
                ],
            }),
        });
        const res = await call(client, 'import_purchase_items', {
            records: [{ shop: 'S', name: 'x', order_id: '1' }, { shop: 'S', name: 'x', order_id: '1' }],
        });
        const data = body(res);
        assert.equal(data.results.length, 1);
        assert.equal(data.results[0].warning, warning);
    });

    test('PT-13: import_purchase_items は 500 件ちょうどを受け付ける', async () => {
        const { client, calls } = await setup();
        const records = Array.from({ length: 500 }, (_, i) => ({ shop: 'S', name: `n${i}`, order_id: 'O', line_no: i }));
        const res = await call(client, 'import_purchase_items', { records });
        assert.ok(!res.isError);
        assert.equal(calls[0][1].records.length, 500);
        assert.equal(body(res).ids.length, 500);
    });

    test('PT-14: import_purchase_items のサーバーエラー（400 超過など）は isError でメッセージを返す', async () => {
        const { client } = await setup({
            importPurchases: async () => { throw new ApiError('bad_request', 400, '不正なリクエストです: 一度に取り込める明細は5000件までです'); },
        });
        const res = await call(client, 'import_purchase_items', { records: [{ shop: 'S', name: 'x', order_id: '1' }] });
        assert.equal(res.isError, true);
        assert.match(res.content[0].text, /5000件/);
    });

    test('PT-15: import_purchase_items の unknownOutcome は「結果不明」と再実行しても重複しない旨を案内する', async () => {
        const { client } = await setup({
            importPurchases: async () => { throw new ApiError('timeout', null, 'タイムアウト', { unknownOutcome: true }); },
        });
        const res = await call(client, 'import_purchase_items', { records: [{ shop: 'S', name: 'x', order_id: '1' }] });
        assert.equal(res.isError, true);
        assert.match(res.content[0].text, /結果不明/);
        assert.match(res.content[0].text, /重複は登録されません/);
    });

    test('PT-16: import_purchase_items の説明に重複キー・分割呼び出し・REST への案内が書かれている', async () => {
        const { client } = await setup();
        const { tools } = await client.listTools();
        const tool = tools.find((t) => t.name === 'import_purchase_items');
        assert.match(tool.description, /order_id/);
        assert.match(tool.description, /line_no/);
        assert.match(tool.description, /二重に登録されません/);
        assert.match(tool.description, /500 件を超える/);
        assert.match(tool.description, /並列にはしない/);
        assert.match(tool.description, /POST \/api\/purchases\/import/);
        assert.deepEqual(tool.annotations, {
            readOnlyHint: false,
            idempotentHint: true,
            destructiveHint: false,
            openWorldHint: false,
        });
    });

    test('PT-20: update_purchase_item は指定した項目だけ patchPurchase に渡し、null もそのまま送る', async () => {
        const { client, calls } = await setup();
        const res = await call(client, 'update_purchase_item', { id: 4, part_id: 7, note: null, unit_price: 12.5 });
        assert.ok(!res.isError);
        assert.deepEqual(calls[0], ['patchPurchase', 4, { unit_price: 12.5, part_id: 7, note: null }]);
        const data = body(res);
        assert.equal(data.updated, true);
        assert.equal(data.item.id, 4);
        assert.deepEqual(data.item.part, { id: 7, name: '高輝度LED' });
        assert.equal(data.item.unit_price, 12.5);
        assert.equal('dedupe_key' in data.item, false);
        assert.equal('created_at' in data.item, false);
        assert.equal('updated_at' in data.item, false);
    });

    test('PT-21: update_purchase_item で part_id: null を送るとひも付けを外す', async () => {
        const { client, calls } = await setup();
        const res = await call(client, 'update_purchase_item', { id: 4, part_id: null });
        assert.deepEqual(calls[0], ['patchPurchase', 4, { part_id: null }]);
        assert.equal(body(res).item.part, null);
    });

    test('PT-22: update_purchase_item は更新項目なしだとエラーで API を呼ばない', async () => {
        const { client, calls } = await setup();
        const res = await call(client, 'update_purchase_item', { id: 4 });
        assert.equal(res.isError, true);
        assert.match(res.content[0].text, /更新する項目/);
        assert.equal(calls.length, 0);
    });

    test('PT-23: update_purchase_item のスキーマ違反（id なし・shop/name の null・負の数量・日付形式）は isError', async () => {
        const { client, calls } = await setup();
        for (const args of [
            { note: 'x' },
            { id: 1, shop: null },
            { id: 1, name: '' },
            { id: 1, quantity: -1 },
            { id: 1, line_no: 1.5 },
            { id: 1, purchased_at: '2026/03/01' },
            { id: 1, part_id: 0 },
        ]) {
            const res = await call(client, 'update_purchase_item', args);
            assert.equal(res.isError, true, JSON.stringify(args));
        }
        assert.equal(calls.length, 0);
    });

    test('PT-24: update_purchase_item の 404 / 409 / unknownOutcome はメッセージ付きの isError', async () => {
        let err = new ApiError('not_found', 404, '購入明細が見つかりません');
        const { client } = await setup({ patchPurchase: async () => { throw err; } });
        let res = await call(client, 'update_purchase_item', { id: 99, note: 'x' });
        assert.equal(res.isError, true);
        assert.match(res.content[0].text, /見つかりません/);

        err = new ApiError('conflict', 409, '競合が発生しました: 同じ明細がすでにあります（id: 3）');
        res = await call(client, 'update_purchase_item', { id: 2, line_no: 1 });
        assert.equal(res.isError, true);
        assert.match(res.content[0].text, /同じ明細がすでにあります/);

        err = new ApiError('timeout', null, 'タイムアウト', { unknownOutcome: true });
        res = await call(client, 'update_purchase_item', { id: 2, note: 'x' });
        assert.equal(res.isError, true);
        assert.match(res.content[0].text, /結果不明/);
        assert.match(res.content[0].text, /search_purchase_items/);
    });
});
