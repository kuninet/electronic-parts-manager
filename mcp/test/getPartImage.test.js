const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { createMcpServer } = require('../server.js');
const { ApiError } = require('../apiClient.js');

describe('MCP get_part_image Tool Unit Tests (GI-1 ~ GI-16)', () => {
    async function createClientWithMock(mockApiClient, { readOnly = false } = {}) {
        const apiClient = {
            apiUrl: 'http://localhost:3001',
            listParts: async () => [],
            getPart: async () => ({}),
            listCategories: async () => [],
            listLocations: async () => [],
            getImage: async () => ({
                buffer: Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]),
                contentType: 'image/jpeg',
                size: 4,
            }),
            ...mockApiClient,
        };
        const server = createMcpServer({ apiClient, version: '1.0.0', readOnly });
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await server.connect(serverTransport);
        const client = new Client({ name: 'test-client', version: '1.0.0' });
        await client.connect(clientTransport);
        return { client, server, apiClient };
    }

    test('GI-1: readOnly: false で 11 ツール登録、get_part_image の annotations と inputSchema.required が正しく設定される', async () => {
        const { client } = await createClientWithMock();
        const toolsResult = await client.listTools();
        assert.equal(toolsResult.tools.length, 11);

        const imgTool = toolsResult.tools.find((t) => t.name === 'get_part_image');
        assert.ok(imgTool);
        assert.deepEqual(imgTool.annotations, {
            readOnlyHint: true,
            idempotentHint: true,
            openWorldHint: false,
        });
        assert.deepEqual(imgTool.inputSchema.required, ['id']);
    });

    test('GI-2: readOnly: true で 5 ツール登録され、get_part_image を含む', async () => {
        const { client } = await createClientWithMock({}, { readOnly: true });
        const toolsResult = await client.listTools();
        assert.equal(toolsResult.tools.length, 5);
        const names = toolsResult.tools.map((t) => t.name).sort();
        assert.deepEqual(names, ['get_part_detail', 'get_part_image', 'list_master_data', 'search_parts', 'search_purchase_items']);
    });

    test('GI-3: 正常系: 写真付き部品で image コンテンツと text コンテンツを正しく返す（isError なし）', async () => {
        const jpegBytes = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x01, 0x02, 0x03]);
        const { client } = await createClientWithMock({
            getPart: async (id) => ({
                id,
                name: 'NE555',
                image_path: '/uploads/a.jpg',
            }),
            getImage: async () => ({
                buffer: jpegBytes,
                contentType: 'image/jpeg',
                size: jpegBytes.length,
            }),
        });

        const res = await client.callTool({
            name: 'get_part_image',
            arguments: { id: 1 },
        });

        assert.equal(res.isError, undefined);
        assert.equal(res.content.length, 2);
        assert.equal(res.content[0].type, 'image');
        assert.equal(res.content[0].mimeType, 'image/jpeg');
        assert.equal(res.content[0].data, jpegBytes.toString('base64'));
        assert.equal(res.content[1].type, 'text');
        assert.equal(res.content[1].text, '部品 ID 1 (NE555) の登録写真です。');
    });

    test('GI-4: getImage の引数に part.image_path が 1 回だけ渡される', async () => {
        let calledPath = null;
        let callCount = 0;
        const { client } = await createClientWithMock({
            getPart: async () => ({
                id: 1,
                name: 'NE555',
                image_path: '/uploads/a.jpg',
            }),
            getImage: async (p) => {
                callCount++;
                calledPath = p;
                return {
                    buffer: Buffer.from([0xFF, 0xD8, 0xFF]),
                    contentType: 'image/jpeg',
                    size: 3,
                };
            },
        });

        await client.callTool({
            name: 'get_part_image',
            arguments: { id: 1 },
        });

        assert.equal(callCount, 1);
        assert.equal(calledPath, '/uploads/a.jpg');
    });

    test('GI-5: image_path が null の場合、テキスト 1 件で「登録されていません」を返す（isError なし、getImage は呼ばれない）', async () => {
        let getImageCalled = false;
        const { client } = await createClientWithMock({
            getPart: async () => ({
                id: 1,
                name: 'NE555',
                image_path: null,
            }),
            getImage: async () => {
                getImageCalled = true;
                return {};
            },
        });

        const res = await client.callTool({
            name: 'get_part_image',
            arguments: { id: 1 },
        });

        assert.equal(res.isError, undefined);
        assert.equal(getImageCalled, false);
        assert.equal(res.content.length, 1);
        assert.equal(res.content[0].type, 'text');
        assert.equal(res.content[0].text, '部品 ID 1 (NE555) には画像が登録されていません。');
    });

    test('GI-6: image_path が空文字、空白文字、キー無しのときも GI-5 と同様に処理される', async () => {
        for (const badPath of ['', '   ', undefined]) {
            const { client } = await createClientWithMock({
                getPart: async () => ({
                    id: 1,
                    name: 'NE555',
                    image_path: badPath,
                }),
            });

            const res = await client.callTool({
                name: 'get_part_image',
                arguments: { id: 1 },
            });

            assert.equal(res.isError, undefined);
            assert.equal(res.content.length, 1);
            assert.match(res.content[0].text, /には画像が登録されていません/);
        }
    });

    test('GI-7: getPart が not_found を投げる場合、isError: true で「部品 ID 999 は見つかりません。」を返す', async () => {
        const { client } = await createClientWithMock({
            getPart: async () => {
                throw new ApiError('not_found', 404, 'リソースが見つかりません');
            },
        });

        const res = await client.callTool({
            name: 'get_part_image',
            arguments: { id: 999 },
        });

        assert.equal(res.isError, true);
        assert.equal(res.content[0].text, '部品 ID 999 は見つかりません。');
    });

    test('GI-8: getPart が network エラーを投げる場合、isError: true で EPM_API_URL を含むメッセージを返す', async () => {
        const { client } = await createClientWithMock({
            getPart: async () => {
                throw new ApiError('network', null, 'API サーバーに接続できません（http://localhost:3001）。EPM_API_URL を確認してください。');
            },
        });

        const res = await client.callTool({
            name: 'get_part_image',
            arguments: { id: 1 },
        });

        assert.equal(res.isError, true);
        assert.match(res.content[0].text, /EPM_API_URL/);
    });

    test('GI-9: getImage が not_found を投げる場合、isError: true で「画像を取得できませんでした」と「画像ファイルが見つかりません」を含む', async () => {
        const { client } = await createClientWithMock({
            getPart: async () => ({
                id: 1,
                name: 'NE555',
                image_path: '/uploads/missing.jpg',
            }),
            getImage: async () => {
                throw new ApiError('not_found', 404, '画像ファイルが見つかりません');
            },
        });

        const res = await client.callTool({
            name: 'get_part_image',
            arguments: { id: 1 },
        });

        assert.equal(res.isError, true);
        assert.match(res.content[0].text, /部品 ID 1 \(NE555\) の画像を取得できませんでした/);
        assert.match(res.content[0].text, /画像ファイルが見つかりません/);
    });

    test('GI-10: getImage が too_large を投げる場合、isError: true で「大きすぎます」と EPM_IMAGE_MAX_BYTES を含む', async () => {
        const { client } = await createClientWithMock({
            getPart: async () => ({
                id: 1,
                name: 'NE555',
                image_path: '/uploads/big.png',
            }),
            getImage: async () => {
                throw new ApiError('too_large', null, '画像が大きすぎます（15.0 MB / 上限 10.0 MB）。EPM_IMAGE_MAX_BYTES で上限を変更できます。');
            },
        });

        const res = await client.callTool({
            name: 'get_part_image',
            arguments: { id: 1 },
        });

        assert.equal(res.isError, true);
        assert.match(res.content[0].text, /大きすぎます/);
        assert.match(res.content[0].text, /EPM_IMAGE_MAX_BYTES/);
    });

    test('GI-11: getImage が invalid_response (text/html) を投げる場合、isError: true で text/html を含む', async () => {
        const { client } = await createClientWithMock({
            getPart: async () => ({
                id: 1,
                name: 'NE555',
                image_path: '/uploads/html.jpg',
            }),
            getImage: async () => {
                throw new ApiError('invalid_response', 200, '画像ではなく text/html が返りました。画像ファイルが削除されている可能性があります。');
            },
        });

        const res = await client.callTool({
            name: 'get_part_image',
            arguments: { id: 1 },
        });

        assert.equal(res.isError, true);
        assert.match(res.content[0].text, /text\/html/);
    });

    test('GI-12: getImage が PNG バイト列を contentType: image/jpeg で返しても Magic Bytes 優先で mimeType === image/png', async () => {
        const pngBytes = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        const { client } = await createClientWithMock({
            getPart: async () => ({
                id: 1,
                name: 'NE555',
                image_path: '/uploads/img.jpg',
            }),
            getImage: async () => ({
                buffer: pngBytes,
                contentType: 'image/jpeg',
                size: pngBytes.length,
            }),
        });

        const res = await client.callTool({
            name: 'get_part_image',
            arguments: { id: 1 },
        });

        assert.equal(res.isError, undefined);
        assert.equal(res.content[0].mimeType, 'image/png');
    });

    test('GI-13: getImage が判定不能バイト列を image/svg+xml で返す場合、isError: true で「対応していません」を含む', async () => {
        const { client } = await createClientWithMock({
            getPart: async () => ({
                id: 1,
                name: 'NE555',
                image_path: '/uploads/vector.svg',
            }),
            getImage: async () => ({
                buffer: Buffer.from('<svg></svg>'),
                contentType: 'image/svg+xml',
                size: 11,
            }),
        });

        const res = await client.callTool({
            name: 'get_part_image',
            arguments: { id: 1 },
        });

        assert.equal(res.isError, true);
        assert.match(res.content[0].text, /対応していません/);
    });

    test('GI-14: size = 800 * 1024 のとき、画像は返り、テキストに 800.0 KB と注意文が付く', async () => {
        const size800k = 800 * 1024;
        const bigBuffer = Buffer.alloc(size800k, 0x00);
        // JPEG magic bytes
        bigBuffer[0] = 0xFF;
        bigBuffer[1] = 0xD8;
        bigBuffer[2] = 0xFF;

        const { client } = await createClientWithMock({
            getPart: async () => ({
                id: 1,
                name: 'NE555',
                image_path: '/uploads/large.jpg',
            }),
            getImage: async () => ({
                buffer: bigBuffer,
                contentType: 'image/jpeg',
                size: size800k,
            }),
        });

        const res = await client.callTool({
            name: 'get_part_image',
            arguments: { id: 1 },
        });

        assert.equal(res.isError, undefined);
        assert.equal(res.content[0].type, 'image');
        assert.equal(res.content[1].type, 'text');
        assert.ok(res.content[1].text.startsWith('部品 ID 1 (NE555) の登録写真です。'));
        assert.match(res.content[1].text, /800\.0 KB/);
        assert.match(res.content[1].text, /表示できない場合があります/);
    });

    test('GI-15: スキーマ違反（引数なし、id: 0, 1.5, "1"）は isError: true となり getPart は呼ばれない', async () => {
        let getPartCalled = false;
        const { client } = await createClientWithMock({
            getPart: async () => {
                getPartCalled = true;
                return {};
            },
        });

        const badArgsList = [{}, { id: 0 }, { id: 1.5 }, { id: '1' }];
        for (const args of badArgsList) {
            const res = await client.callTool({
                name: 'get_part_image',
                arguments: args,
            });
            assert.equal(res.isError, true);
        }
        assert.equal(getPartCalled, false);
    });

    test('GI-16: ゴミ箱の部品（deleted_at あり）でも画像が返る', async () => {
        const jpegBytes = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);
        const { client } = await createClientWithMock({
            getPart: async () => ({
                id: 5,
                name: '廃番パーツ',
                deleted_at: '2026-01-01T00:00:00Z',
                image_path: '/uploads/trash.jpg',
            }),
            getImage: async () => ({
                buffer: jpegBytes,
                contentType: 'image/jpeg',
                size: 4,
            }),
        });

        const res = await client.callTool({
            name: 'get_part_image',
            arguments: { id: 5 },
        });

        assert.equal(res.isError, undefined);
        assert.equal(res.content[0].type, 'image');
    });
});
