const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('API トークン認証 配線・静的検査 (MW-1, MW-2)', async (t) => {
    await t.test('MW-1: server/index.js で cors < createApiTokenAuth < 最初の /api ルート の順序が守られていること', () => {
        const indexPath = path.join(__dirname, '../index.js');
        const content = fs.readFileSync(indexPath, 'utf-8');

        const corsPos = content.indexOf('app.use(cors(');
        const authPos = content.search(/createApiTokenAuth\s*\(/);
        const firstApiRouteMatch = content.search(/app\.use\(\s*['"]\/api\//);

        assert.ok(corsPos !== -1, 'cors() が見つかること');
        assert.ok(authPos !== -1, 'createApiTokenAuth() が見つかること');
        assert.ok(firstApiRouteMatch !== -1, '最初の app.use("/api/...") が見つかること');

        assert.ok(
            corsPos < authPos,
            `cors() (${corsPos}) は createApiTokenAuth (${authPos}) より前にあること`
        );
        assert.ok(
            authPos < firstApiRouteMatch,
            `createApiTokenAuth (${authPos}) は 最初の /api ルート (${firstApiRouteMatch}) より前にあること`
        );
    });

    await t.test('MW-2: apiTokenAuth.js に timingSafeEqual があり、127.0.0.1 / ::1 の文字列が無いこと', () => {
        const middlewarePath = path.join(__dirname, '../middleware/apiTokenAuth.js');
        const content = fs.readFileSync(middlewarePath, 'utf-8');

        assert.ok(
            content.includes('timingSafeEqual'),
            'timingSafeEqual が使用されていること'
        );
        assert.ok(
            !content.includes('127.0.0.1'),
            '127.0.0.1 によるループバック免除が含まれていないこと'
        );
        assert.ok(
            !content.includes('::1'),
            '::1 によるループバック免除が含まれていないこと'
        );
    });
});
