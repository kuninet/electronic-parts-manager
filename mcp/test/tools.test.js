const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { createMcpServer } = require('../server.js');
const { ApiError } = require('../apiClient.js');

describe('MCP Tools Unit Tests (T-1 ~ T-14)', () => {
    async function createClientWithMock(mockApiClient) {
        const apiClient = {
            apiUrl: 'http://localhost:3001',
            listParts: async () => [],
            getPart: async () => ({}),
            listCategories: async () => [],
            listLocations: async () => [],
            ...mockApiClient,
        };
        const server = createMcpServer({ apiClient, version: '1.0.0' });
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await server.connect(serverTransport);
        const client = new Client({ name: 'test-client', version: '1.0.0' });
        await client.connect(clientTransport);
        return { client, server, apiClient };
    }

    test('T-1: 6ツールが登録され、参照系は readOnlyHint: true、書き込み系は false', async () => {
        const { client } = await createClientWithMock();
        const toolsResult = await client.listTools();
        const tools = toolsResult.tools;

        assert.equal(tools.length, 6);
        const names = tools.map((t) => t.name).sort();
        assert.deepEqual(names, [
            'create_part',
            'get_part_detail',
            'list_master_data',
            'search_parts',
            'store_part_location',
            'update_part_quantity',
        ]);

        const readOnlyTools = ['get_part_detail', 'list_master_data', 'search_parts'];
        const writeTools = ['create_part', 'store_part_location', 'update_part_quantity'];

        for (const tool of tools) {
            if (readOnlyTools.includes(tool.name)) {
                assert.equal(tool.annotations?.readOnlyHint, true, `${tool.name} should have readOnlyHint: true`);
            } else if (writeTools.includes(tool.name)) {
                assert.equal(tool.annotations?.readOnlyHint, false, `${tool.name} should have readOnlyHint: false`);
            }
        }
    });

    test('T-2: search_parts の inputSchema に limit の default, min, max があり、required が空', async () => {
        const { client } = await createClientWithMock();
        const toolsResult = await client.listTools();
        const searchTool = toolsResult.tools.find((t) => t.name === 'search_parts');

        assert.ok(searchTool);
        const limitProp = searchTool.inputSchema.properties.limit;
        assert.equal(limitProp.default, 50);
        assert.equal(limitProp.minimum, 1);
        assert.equal(limitProp.maximum, 200);

        // required は未定義か空配列
        const required = searchTool.inputSchema.required || [];
        assert.equal(required.length, 0);
    });

    test('T-3: 120件ある場合、デフォルトで先頭50件が返り truncated: true となる', async () => {
        const dummyParts = Array.from({ length: 120 }, (_, i) => ({
            id: i + 1,
            name: `部品 ${i + 1}`,
            part_number: `PN-${i + 1}`,
            quantity: 10,
        }));

        let calledParams = null;
        const { client } = await createClientWithMock({
            listParts: async (params) => {
                calledParams = params;
                return dummyParts;
            },
        });

        const res = await client.callTool({ name: 'search_parts', arguments: {} });
        assert.equal(res.isError, undefined);

        assert.deepEqual(calledParams, {
            search: undefined,
            category_id: undefined,
            location_id: undefined,
        });

        const data = JSON.parse(res.content[0].text);
        assert.equal(data.total, 120);
        assert.equal(data.returned, 50);
        assert.equal(data.truncated, true);
        assert.equal(data.parts.length, 50);
        assert.equal(data.parts[0].id, 1);
        assert.equal(data.parts[49].id, 50);
        assert.ok(data.hint);
    });

    test('T-4: query, category_id, location_id, limit の指定が正しく渡る', async () => {
        const dummyParts = Array.from({ length: 20 }, (_, i) => ({
            id: i + 1,
            name: `LED ${i + 1}`,
        }));

        let calledParams = null;
        const { client } = await createClientWithMock({
            listParts: async (params) => {
                calledParams = params;
                return dummyParts;
            },
        });

        const res = await client.callTool({
            name: 'search_parts',
            arguments: {
                query: 'LED',
                category_id: 2,
                location_id: 3,
                limit: 10,
            },
        });

        assert.deepEqual(calledParams, {
            search: 'LED',
            category_id: 2,
            location_id: 3,
        });

        const data = JSON.parse(res.content[0].text);
        assert.equal(data.returned, 10);
        assert.equal(data.total, 20);
        assert.equal(data.truncated, true);
    });

    test('T-5: 件数が limit 以下のときは truncated: false で hint が無い', async () => {
        const dummyParts = [
            { id: 1, name: 'Part 1' },
            { id: 2, name: 'Part 2' },
            { id: 3, name: 'Part 3' },
        ];

        const { client } = await createClientWithMock({
            listParts: async () => dummyParts,
        });

        const res = await client.callTool({
            name: 'search_parts',
            arguments: { limit: 50 },
        });

        const data = JSON.parse(res.content[0].text);
        assert.equal(data.total, 3);
        assert.equal(data.returned, 3);
        assert.equal(data.truncated, false);
        assert.equal(data.hint, undefined);
    });

    test('T-6: 0件の場合は isError でなく total: 0, parts: [] を返す', async () => {
        const { client } = await createClientWithMock({
            listParts: async () => [],
        });

        const res = await client.callTool({
            name: 'search_parts',
            arguments: { query: 'zzz' },
        });

        assert.equal(res.isError, undefined);
        const data = JSON.parse(res.content[0].text);
        assert.equal(data.total, 0);
        assert.equal(data.returned, 0);
        assert.equal(data.truncated, false);
        assert.deepEqual(data.parts, []);
    });

    test('T-7: スキーマ違反の引数は isError: true となり listParts は呼ばれない', async () => {
        let called = false;
        const { client } = await createClientWithMock({
            listParts: async () => {
                called = true;
                return [];
            },
        });

        const res1 = await client.callTool({
            name: 'search_parts',
            arguments: { limit: 0 },
        });
        assert.equal(res1.isError, true);
        assert.equal(called, false);

        const res2 = await client.callTool({
            name: 'search_parts',
            arguments: { limit: 201 },
        });
        assert.equal(res2.isError, true);
        assert.equal(called, false);

        const res3 = await client.callTool({
            name: 'search_parts',
            arguments: { category_id: -1 },
        });
        assert.equal(res3.isError, true);
        assert.equal(called, false);
    });

    test('T-8: get_part_detail は指定 ID の部品詳細と status を返す', async () => {
        const samplePart = {
            id: 5,
            name: 'ESP32',
            part_number: 'ESP32-WROOM-32E',
            quantity: 4,
            description: 'Wi-Fi/BLE マイコンモジュール',
            category_id: 1,
            category_name: 'マイコン',
            location_id: 2,
            location_name: 'ケースB',
            tags: 'MCU, ESP32',
            image_path: '/uploads/esp32.jpg',
            datasheet_url: 'https://example.com/esp32.pdf',
            qr_code: 'P-0005',
            used_at: null,
            deleted_at: null,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-02T00:00:00Z',
        };

        const { client } = await createClientWithMock({
            getPart: async (id) => {
                assert.equal(id, 5);
                return samplePart;
            },
        });

        const res = await client.callTool({
            name: 'get_part_detail',
            arguments: { id: 5 },
        });

        assert.equal(res.isError, undefined);
        const data = JSON.parse(res.content[0].text);
        assert.equal(data.id, 5);
        assert.equal(data.name, 'ESP32');
        assert.equal(data.status, 'active');
        assert.equal(data.datasheet_url, 'https://example.com/esp32.pdf');
        assert.equal(data.qr_code, 'P-0005');
    });

    test('T-9: get_part_detail で 404 の場合、isError: true で ID と search_parts を含む案内を返す', async () => {
        const { client } = await createClientWithMock({
            getPart: async (id) => {
                throw new ApiError('not_found', 404, 'リソースが見つかりません');
            },
        });

        const res = await client.callTool({
            name: 'get_part_detail',
            arguments: { id: 9999 },
        });

        assert.equal(res.isError, true);
        assert.match(res.content[0].text, /9999/);
        assert.match(res.content[0].text, /search_parts/);
    });

    test('T-10: get_part_detail の入力検証（引数なしまたは小数）', async () => {
        const { client } = await createClientWithMock();

        const res1 = await client.callTool({
            name: 'get_part_detail',
            arguments: {},
        });
        assert.equal(res1.isError, true);

        const res2 = await client.callTool({
            name: 'get_part_detail',
            arguments: { id: 1.5 },
        });
        assert.equal(res2.isError, true);
    });

    test('T-11: list_master_data {} で categories と locations の両方が取得される', async () => {
        let categoriesCalled = 0;
        let locationsCalled = 0;

        const { client } = await createClientWithMock({
            listCategories: async () => {
                categoriesCalled++;
                return [{ id: 1, name: '抵抗', display_order: 0 }];
            },
            listLocations: async () => {
                locationsCalled++;
                return [{ id: 2, name: '引き出しA', display_order: 0 }];
            },
        });

        const res = await client.callTool({
            name: 'list_master_data',
            arguments: {},
        });

        assert.equal(res.isError, undefined);
        assert.equal(categoriesCalled, 1);
        assert.equal(locationsCalled, 1);

        const data = JSON.parse(res.content[0].text);
        assert.ok(data.categories);
        assert.ok(data.locations);
        assert.equal(data.categories[0].name, '抵抗');
        assert.equal(data.locations[0].name, '引き出しA');
    });

    test('T-12: list_master_data { type: "locations" } は locations だけを取得する', async () => {
        let categoriesCalled = 0;
        let locationsCalled = 0;

        const { client } = await createClientWithMock({
            listCategories: async () => {
                categoriesCalled++;
                return [];
            },
            listLocations: async () => {
                locationsCalled++;
                return [{ id: 3, name: '棚C', display_order: 1 }];
            },
        });

        const res = await client.callTool({
            name: 'list_master_data',
            arguments: { type: 'locations' },
        });

        assert.equal(res.isError, undefined);
        assert.equal(categoriesCalled, 0);
        assert.equal(locationsCalled, 1);

        const data = JSON.parse(res.content[0].text);
        assert.equal(data.categories, undefined);
        assert.ok(data.locations);
        assert.equal(data.locations[0].name, '棚C');
    });

    test('T-13: list_master_data { type: "tags" } は enum 違反で isError: true となる', async () => {
        const { client } = await createClientWithMock();

        const res = await client.callTool({
            name: 'list_master_data',
            arguments: { type: 'tags' },
        });

        assert.equal(res.isError, true);
    });

    test('T-14: network エラー時は isError: true となり EPM_API_URL を含み、サーバーは後続呼出に応答し続ける', async () => {
        let shouldFail = true;
        const { client } = await createClientWithMock({
            listParts: async () => {
                if (shouldFail) {
                    throw new ApiError(
                        'network',
                        null,
                        'API サーバーに接続できません（http://localhost:3001）。サーバーが起動しているか、EPM_API_URL を確認してください。'
                    );
                }
                return [{ id: 1, name: '回復した部品' }];
            },
        });

        const res1 = await client.callTool({
            name: 'search_parts',
            arguments: {},
        });

        assert.equal(res1.isError, true);
        assert.match(res1.content[0].text, /EPM_API_URL/);

        // 後続の呼び出しに応答し続けることを確認
        shouldFail = false;
        const res2 = await client.callTool({
            name: 'search_parts',
            arguments: {},
        });

        assert.equal(res2.isError, undefined);
        const data = JSON.parse(res2.content[0].text);
        assert.equal(data.parts.length, 1);
        assert.equal(data.parts[0].name, '回復した部品');
    });
});
