const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { createMcpServer } = require('../server.js');
const { ApiError } = require('../apiClient.js');

describe('MCP 書き込みツール単体テスト (WT-1 ~ WT-20)', () => {
    async function createClientWithMock(mockApiClient, { readOnly = false } = {}) {
        const apiClient = {
            apiUrl: 'http://localhost:3001',
            listParts: async () => [],
            getPart: async () => ({ id: 1, name: 'テスト' }),
            listCategories: async () => [],
            listLocations: async () => [],
            createPart: async () => ({ id: 1 }),
            changeQuantity: async () => ({ part_id: 1, previous_quantity: 10, new_quantity: 15, delta: 5, reason: null }),
            storePart: async () => ({ part_id: 1, location_id: 2, previous_location_id: null, previous_location_name: null, unchanged: false, log_id: 1 }),
            ...mockApiClient,
        };
        const server = createMcpServer({ apiClient, version: '1.0.0', readOnly });
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await server.connect(serverTransport);
        const client = new Client({ name: 'test-client', version: '1.0.0' });
        await client.connect(clientTransport);
        return { client, server, apiClient };
    }

    test('WT-1: readOnly: false では 13 ツールが登録され、書き込みツールは readOnlyHint: false、store_part_location・import_purchase_items・update_purchase_item だけが idempotentHint: true', async () => {
        const { client } = await createClientWithMock({}, { readOnly: false });
        const { tools } = await client.listTools();
        assert.equal(tools.length, 13);

        const createTool = tools.find(t => t.name === 'create_part');
        const updateTool = tools.find(t => t.name === 'update_part_quantity');
        const storeTool = tools.find(t => t.name === 'store_part_location');
        const patchTool = tools.find(t => t.name === 'update_part');

        assert.equal(patchTool.annotations?.readOnlyHint, false);
        assert.equal(patchTool.annotations?.idempotentHint, false);
        assert.equal(patchTool.annotations?.destructiveHint, false);

        assert.equal(createTool.annotations?.readOnlyHint, false);
        assert.equal(createTool.annotations?.idempotentHint, false);
        assert.equal(createTool.annotations?.destructiveHint, false);

        assert.equal(updateTool.annotations?.readOnlyHint, false);
        assert.equal(updateTool.annotations?.idempotentHint, false);
        assert.equal(updateTool.annotations?.destructiveHint, true);

        assert.equal(storeTool.annotations?.readOnlyHint, false);
        assert.equal(storeTool.annotations?.idempotentHint, true);
        assert.equal(storeTool.annotations?.destructiveHint, false);

        const undoTool = tools.find(t => t.name === 'undo_import_batch');
        assert.equal(undoTool.annotations?.readOnlyHint, false);
        assert.equal(undoTool.annotations?.idempotentHint, false);
        assert.equal(undoTool.annotations?.destructiveHint, true);

        for (const name of ['import_purchase_items', 'update_purchase_item']) {
            const tool = tools.find(t => t.name === name);
            assert.equal(tool.annotations?.readOnlyHint, false, name);
            assert.equal(tool.annotations?.idempotentHint, true, name);
            assert.equal(tool.annotations?.destructiveHint, false, name);
        }
    });

    test('WT-2: readOnly: true では参照系の 6 ツールのみ登録される', async () => {
        const { client } = await createClientWithMock({}, { readOnly: true });
        const { tools } = await client.listTools();
        assert.equal(tools.length, 6);
        const names = tools.map(t => t.name).sort();
        assert.deepEqual(names, ['get_part_detail', 'get_part_image', 'list_import_batches', 'list_master_data', 'search_parts', 'search_purchase_items']);
        assert.ok(!names.includes('update_part'));
        assert.ok(!names.includes('import_purchase_items'));
        assert.ok(!names.includes('undo_import_batch'));
        assert.ok(!names.includes('update_purchase_item'));
    });

    test('WT-3: create_part { name: "LED", quantity: 5 } で createPart が undefined キーなしで呼ばれ、作成部品詳細が返る', async () => {
        let calledPayload = null;
        const mockPart = { id: 9, name: 'LED', quantity: 5, category_id: null, location_id: null };

        const { client } = await createClientWithMock({
            createPart: async (payload) => {
                calledPayload = payload;
                return { id: 9 };
            },
            getPart: async (id) => {
                assert.equal(id, 9);
                return mockPart;
            }
        });

        const res = await client.callTool({
            name: 'create_part',
            arguments: { name: 'LED', quantity: 5 }
        });

        assert.ok(!res.isError);
        assert.deepEqual(calledPayload, { name: 'LED', quantity: 5 });
        assert.ok(!('category_id' in calledPayload));
        assert.ok(!('location_id' in calledPayload));

        const body = JSON.parse(res.content[0].text);
        assert.equal(body.created, true);
        assert.equal(body.part.id, 9);
        assert.equal(body.part.name, 'LED');
    });

    test('WT-3b: create_part で shop, purchased_at, unit_price が API に渡り、結果に shop が含まれる', async () => {
        let calledPayload = null;
        const { client } = await createClientWithMock({
            createPart: async (payload) => {
                calledPayload = payload;
                return { id: 11 };
            },
            getPart: async () => ({ id: 11, name: 'R', quantity: 0, shop: '秋月電子' })
        });

        const res = await client.callTool({
            name: 'create_part',
            arguments: { name: 'R', shop: '秋月電子', purchased_at: '2026-03-01', unit_price: 1.5 }
        });

        assert.ok(!res.isError);
        assert.deepEqual(calledPayload, {
            name: 'R', quantity: 0, shop: '秋月電子', purchased_at: '2026-03-01', unit_price: 1.5
        });
        assert.equal(JSON.parse(res.content[0].text).part.shop, '秋月電子');

        const bad = await client.callTool({
            name: 'create_part',
            arguments: { name: 'R', purchased_at: '2026/03/01' }
        });
        assert.equal(bad.isError, true);
        const neg = await client.callTool({
            name: 'create_part',
            arguments: { name: 'R', unit_price: -1 }
        });
        assert.equal(neg.isError, true);
        const huge = await client.callTool({
            name: 'create_part',
            arguments: { name: 'R', unit_price: 1e9 + 1 }
        });
        assert.equal(huge.isError, true);
    });

    test('WT-4: create_part { name: "R" } で quantity 未指定時は quantity: 0 で送られる', async () => {
        let calledPayload = null;
        const { client } = await createClientWithMock({
            createPart: async (payload) => {
                calledPayload = payload;
                return { id: 10 };
            },
            getPart: async () => ({ id: 10, name: 'R', quantity: 0 })
        });

        const res = await client.callTool({
            name: 'create_part',
            arguments: { name: 'R' }
        });

        assert.ok(!res.isError);
        assert.equal(calledPayload.quantity, 0);
    });

    test('WT-5: create_part { category_name: "led" } でカテゴリ名が解決され category_id: 2 が送られる', async () => {
        let calledPayload = null;
        const { client } = await createClientWithMock({
            listCategories: async () => [{ id: 2, name: 'LED' }],
            createPart: async (payload) => {
                calledPayload = payload;
                return { id: 11 };
            },
            getPart: async () => ({ id: 11, name: 'x', category_id: 2 })
        });

        const res = await client.callTool({
            name: 'create_part',
            arguments: { name: 'x', category_name: 'led' }
        });

        assert.ok(!res.isError);
        assert.equal(calledPayload.category_id, 2);
        assert.ok(!('category_name' in calledPayload));
    });

    test('WT-6: create_part で存在しない category_name は isError: true となり、候補と list_master_data を含む', async () => {
        let createCalled = false;
        const { client } = await createClientWithMock({
            listCategories: async () => [{ id: 2, name: 'LED' }],
            createPart: async () => {
                createCalled = true;
                return { id: 1 };
            }
        });

        const res = await client.callTool({
            name: 'create_part',
            arguments: { name: 'x', category_name: 'センサ' }
        });

        assert.equal(res.isError, true);
        assert.equal(createCalled, false);
        assert.match(res.content[0].text, /存在しません/);
        assert.match(res.content[0].text, /list_master_data/);
    });

    test('WT-7: category_name が複数ヒットする場合は isError: true となり、両方の id を含む', async () => {
        const { client } = await createClientWithMock({
            listCategories: async () => [
                { id: 3, name: 'IC' },
                { id: 7, name: 'ic' },
            ]
        });

        const res = await client.callTool({
            name: 'create_part',
            arguments: { name: 'x', category_name: 'IC' }
        });

        assert.equal(res.isError, true);
        assert.match(res.content[0].text, /3/);
        assert.match(res.content[0].text, /7/);
        assert.match(res.content[0].text, /複数あります/);
    });

    test('WT-8: category_id と category_name の両方を指定すると isError: true', async () => {
        const { client } = await createClientWithMock();
        const res = await client.callTool({
            name: 'create_part',
            arguments: { name: 'x', category_id: 1, category_name: 'LED' }
        });

        assert.equal(res.isError, true);
        assert.match(res.content[0].text, /どちらか一方/);
    });

    test('WT-9: 保管場所（location_name, location_id）でも名前解決・検証が正しく行われる', async () => {
        let calledPayload = null;
        const { client } = await createClientWithMock({
            listLocations: async () => [{ id: 5, name: '棚A' }],
            createPart: async (payload) => {
                calledPayload = payload;
                return { id: 12 };
            },
            getPart: async () => ({ id: 12, name: 'x', location_id: 5 })
        });

        // 正常解決
        const res1 = await client.callTool({
            name: 'create_part',
            arguments: { name: 'x', location_name: '棚a' }
        });
        assert.ok(!res1.isError);
        assert.equal(calledPayload.location_id, 5);

        // 両方指定エラー
        const res2 = await client.callTool({
            name: 'create_part',
            arguments: { name: 'x', location_id: 5, location_name: '棚A' }
        });
        assert.equal(res2.isError, true);
        assert.match(res2.content[0].text, /どちらか一方/);
    });

    test('WT-10: 型番重複チェックで既存部品がある場合は isError: true となり、update_part_quantity 案内を含む', async () => {
        let createCalled = false;
        const { client } = await createClientWithMock({
            listParts: async () => [
                { id: 20, name: '赤色LED', part_number: 'OSR5JA', quantity: 10, location_name: '箱A' }
            ],
            createPart: async () => {
                createCalled = true;
                return { id: 21 };
            }
        });

        const res = await client.callTool({
            name: 'create_part',
            arguments: { name: 'LED', part_number: 'osr5ja' }
        });

        assert.equal(res.isError, true);
        assert.equal(createCalled, false);
        assert.match(res.content[0].text, /既に存在します/);
        assert.match(res.content[0].text, /20/);
        assert.match(res.content[0].text, /update_part_quantity/);
    });

    test('WT-11: allow_duplicate: true を指定した場合は重複型番であっても作成される', async () => {
        let createCalled = false;
        const { client } = await createClientWithMock({
            listParts: async () => [
                { id: 20, name: '赤色LED', part_number: 'OSR5JA', quantity: 10 }
            ],
            createPart: async () => {
                createCalled = true;
                return { id: 21 };
            },
            getPart: async () => ({ id: 21, name: 'LED', part_number: 'OSR5JA' })
        });

        const res = await client.callTool({
            name: 'create_part',
            arguments: { name: 'LED', part_number: 'osr5ja', allow_duplicate: true }
        });

        assert.ok(!res.isError);
        assert.equal(createCalled, true);
    });

    test('WT-12: getPart が失敗した場合でも作成自体は成功しているため isError: false で warning を返す', async () => {
        const { client } = await createClientWithMock({
            createPart: async () => ({ id: 22 }),
            getPart: async () => {
                throw new Error('Network error on get');
            }
        });

        const res = await client.callTool({
            name: 'create_part',
            arguments: { name: 'テスト部品' }
        });

        assert.ok(!res.isError);
        const body = JSON.parse(res.content[0].text);
        assert.equal(body.created, true);
        assert.equal(body.part.id, 22);
        assert.match(body.warning, /詳細の取得に失敗しました/);
    });

    test('WT-13: createPart が ApiError(timeout, unknownOutcome: true) を投げた場合、結果不明と search_parts を案内する', async () => {
        const { client } = await createClientWithMock({
            createPart: async () => {
                throw new ApiError('timeout', null, 'Request timeout', { unknownOutcome: true });
            }
        });

        const res = await client.callTool({
            name: 'create_part',
            arguments: { name: 'タイムアウト部品' }
        });

        assert.equal(res.isError, true);
        assert.match(res.content[0].text, /結果不明/);
        assert.match(res.content[0].text, /search_parts/);
    });

    test('WT-14: update_part_quantity { id: 1, delta: 5, reason: "購入" } で数量が変更され結果が返る', async () => {
        let calledId = null;
        let calledPayload = null;

        const { client } = await createClientWithMock({
            changeQuantity: async (id, payload) => {
                calledId = id;
                calledPayload = payload;
                return {
                    part_id: 1,
                    previous_quantity: 10,
                    new_quantity: 15,
                    delta: 5,
                    reason: '購入',
                };
            }
        });

        const res = await client.callTool({
            name: 'update_part_quantity',
            arguments: { id: 1, delta: 5, reason: '購入' }
        });

        assert.ok(!res.isError);
        assert.equal(calledId, 1);
        assert.deepEqual(calledPayload, { delta: 5, reason: '購入' });

        const body = JSON.parse(res.content[0].text);
        assert.deepEqual(body, {
            id: 1,
            previous_quantity: 10,
            new_quantity: 15,
            delta: 5,
            reason: '購入',
        });
    });

    test('WT-15: update_part_quantity で delta/absolute の未指定・両方指定・delta: 0 は isError: true となり API は呼ばれない', async () => {
        let called = false;
        const { client } = await createClientWithMock({
            changeQuantity: async () => {
                called = true;
            }
        });

        const badArgsList = [
            { id: 1 },
            { id: 1, delta: 1, absolute: 2 },
            { id: 1, delta: 0 },
        ];

        for (const args of badArgsList) {
            const res = await client.callTool({
                name: 'update_part_quantity',
                arguments: args
            });
            assert.equal(res.isError, true);
            assert.equal(called, false);
        }
    });

    test('WT-16: update_part_quantity スキーマ違反（absolute: -1, delta: 1.5）は isError: true', async () => {
        const { client } = await createClientWithMock();

        const res1 = await client.callTool({
            name: 'update_part_quantity',
            arguments: { id: 1, absolute: -1 }
        });
        assert.equal(res1.isError, true);

        const res2 = await client.callTool({
            name: 'update_part_quantity',
            arguments: { id: 1, delta: 1.5 }
        });
        assert.equal(res2.isError, true);
    });

    test('WT-17: changeQuantity が ApiError(bad_request, "在庫数が負になります") を投げた場合、本文を含む isError: true', async () => {
        const { client } = await createClientWithMock({
            changeQuantity: async () => {
                throw new ApiError('bad_request', 400, '不正なリクエストです: 在庫数が負になります（現在 3）');
            }
        });

        const res = await client.callTool({
            name: 'update_part_quantity',
            arguments: { id: 1, delta: -5 }
        });

        assert.equal(res.isError, true);
        assert.match(res.content[0].text, /負になります/);
    });

    test('WT-18: store_part_location { part_id: 5, location_id: 3 } で memo: "MCP" が送られ、格納ログ情報が返る', async () => {
        let calledPayload = null;
        const { client } = await createClientWithMock({
            storePart: async (payload) => {
                calledPayload = payload;
                return {
                    part_id: 5,
                    location_id: 3,
                    previous_location_id: 1,
                    previous_location_name: '棚A',
                    unchanged: false,
                    log_id: 42,
                };
            }
        });

        const res = await client.callTool({
            name: 'store_part_location',
            arguments: { part_id: 5, location_id: 3 }
        });

        assert.ok(!res.isError);
        assert.deepEqual(calledPayload, { part_id: 5, location_id: 3, memo: 'MCP' });

        const body = JSON.parse(res.content[0].text);
        assert.deepEqual(body, {
            part_id: 5,
            location_id: 3,
            previous_location_id: 1,
            previous_location_name: '棚A',
            unchanged: false,
            log_id: 42,
        });
    });

    test('WT-19: store_part_location で同じ場所への再格納（unchanged: true）時は isError: false で unchanged: true が返る', async () => {
        const { client } = await createClientWithMock({
            storePart: async () => ({
                part_id: 5,
                location_id: 3,
                previous_location_id: 3,
                previous_location_name: '棚B',
                unchanged: true,
                log_id: null,
            })
        });

        const res = await client.callTool({
            name: 'store_part_location',
            arguments: { part_id: 5, location_id: 3 }
        });

        assert.ok(!res.isError);
        const body = JSON.parse(res.content[0].text);
        assert.equal(body.unchanged, true);
    });

    test('WT-20: store_part_location で保管場所が見つからない場合は isError: true となり本文が保持される', async () => {
        const { client } = await createClientWithMock({
            storePart: async () => {
                throw new ApiError('not_found', 404, '保管場所が見つかりません');
            }
        });

        const res = await client.callTool({
            name: 'store_part_location',
            arguments: { part_id: 5, location_id: 999 }
        });

        assert.equal(res.isError, true);
        assert.match(res.content[0].text, /保管場所が見つかりません/);
    });
});
