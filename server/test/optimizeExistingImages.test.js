const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { createTestDb } = require('./testHelper');
const {
    optimizeExistingImages,
    rollbackOptimization,
    processImageBuffer
} = require('../scripts/optimize-existing-images');

test('既存画像一括最適化スクリプトのテスト', async (t) => {
    const testUploadsDir = path.join(__dirname, 'temp_uploads');
    const testBackupsBaseDir = path.join(__dirname, '../backups/images');
    let db;

    t.before(async () => {
        if (!fs.existsSync(testUploadsDir)) {
            fs.mkdirSync(testUploadsDir, { recursive: true });
        }
    });

    t.after(async () => {
        if (fs.existsSync(testUploadsDir)) {
            fs.rmSync(testUploadsDir, { recursive: true, force: true });
        }
        // テストで作成されたバックアップディレクトリのクリーンアップ
        if (fs.existsSync(testBackupsBaseDir)) {
            fs.rmSync(testBackupsBaseDir, { recursive: true, force: true });
        }
    });

    t.beforeEach(async () => {
        db = await createTestDb();
        // ディレクトリを初期化
        const entries = fs.readdirSync(testUploadsDir);
        for (const entry of entries) {
            fs.rmSync(path.join(testUploadsDir, entry), { recursive: true, force: true });
        }
    });

    await t.test('processImageBuffer - 1600x1200 の画像を長辺1200px・品質80%にリサイズできること', async () => {
        // 1600x1200 のJPEG画像を作成
        const largeBuffer = await sharp({
            create: {
                width: 1600,
                height: 1200,
                channels: 3,
                background: { r: 100, g: 150, b: 200 }
            }
        }).jpeg({ quality: 95 }).toBuffer();

        const result = await processImageBuffer(largeBuffer, '.jpg', 1200, 80);
        assert.strictEqual(result.origWidth, 1600);
        assert.strictEqual(result.origHeight, 1200);
        assert.strictEqual(result.newWidth, 1200);
        assert.strictEqual(result.newHeight, 900);
        assert.ok(result.newSize < result.origSize, '最適化後サイズが小さくなっていること');
    });

    await t.test('optimizeExistingImages - 500KB以下かつ長辺1200px以下の画像はスキップされること', async () => {
        // 200x200 の小さい画像を作成（数十KB）
        const smallBuffer = await sharp({
            create: {
                width: 200,
                height: 200,
                channels: 3,
                background: { r: 10, g: 20, b: 30 }
            }
        }).jpeg({ quality: 80 }).toBuffer();

        const smallFileName = 'small-already-optimized.jpg';
        await fs.promises.writeFile(path.join(testUploadsDir, smallFileName), smallBuffer);

        const result = await optimizeExistingImages({
            uploadsDir: testUploadsDir,
            db,
            maxWidth: 1200,
            quality: 80
        });

        // apply未指定時はデフォルトで dryRun: true
        assert.strictEqual(result.dryRun, true);
        assert.strictEqual(result.totalFiles, 1);
        assert.strictEqual(result.targetCount, 0, 'すでに小さい画像は対象外としてスキップされること');
    });

    await t.test('optimizeExistingImages - 既定でdry-runとして動作し、ファイル・DB変更なしに対象を報告すること', async () => {
        const largeBuffer = await sharp({
            create: {
                width: 1600,
                height: 900,
                channels: 3,
                background: { r: 50, g: 100, b: 150 }
            }
        }).jpeg({ quality: 95 }).toBuffer();

        const testFileName = 'large-test-part.jpg';
        const filePath = path.join(testUploadsDir, testFileName);
        await fs.promises.writeFile(filePath, largeBuffer);

        const imageDbPath = `/uploads/${testFileName}`;
        await db.run('INSERT INTO parts (name, image_path) VALUES (?, ?)', ['大型画像部品', imageDbPath]);

        // apply: false (または未指定) で実行 -> 既定でドライラン
        const result = await optimizeExistingImages({
            uploadsDir: testUploadsDir,
            db,
            maxWidth: 1200,
            quality: 80
        });

        assert.strictEqual(result.dryRun, true, '既定動作がドライランであること');
        assert.strictEqual(result.totalFiles, 1);
        assert.strictEqual(result.targetCount, 1);
        assert.ok(result.totalSavedBytes > 0);

        // ファイルが変更されていないこと
        const currentStat = await fs.promises.stat(filePath);
        assert.strictEqual(currentStat.size, largeBuffer.length);

        // DBが変更されていないこと
        const part = await db.get('SELECT image_path FROM parts WHERE name = ?', ['大型画像部品']);
        assert.strictEqual(part.image_path, imageDbPath);
    });

    await t.test('optimizeExistingImages & rollbackOptimization - --applyでの本番実行・アトミックリネーム・parts.updated_at非更新・ロールバック整合性', async () => {
        // 1600x1200 の画像を生成
        const largeBuffer = await sharp({
            create: {
                width: 1600,
                height: 1200,
                channels: 3,
                background: { r: 200, g: 80, b: 50 }
            }
        }).jpeg({ quality: 95 }).toBuffer();

        const testFileName = 'opt-target.jpg';
        const originalPath = path.join(testUploadsDir, testFileName);
        await fs.promises.writeFile(originalPath, largeBuffer);

        const oldImageDbPath = `/uploads/${testFileName}`;

        // 過去の日時で parts を登録（updated_at が上書きされないことを確認するため）
        const fixedPastDate = '2025-01-01 00:00:00';
        const partRes = await db.run(
            'INSERT INTO parts (name, image_path, updated_at) VALUES (?, ?, ?)',
            ['対象部品', oldImageDbPath, fixedPastDate]
        );
        const locRes = await db.run('INSERT INTO locations (name, image_path) VALUES (?, ?)', ['対象場所', oldImageDbPath]);
        await db.run('INSERT INTO ai_name_suggestions (part_id, image_path, suggested_name) VALUES (?, ?, ?)', [partRes.lastID, oldImageDbPath, 'AI判定候補']);

        // 最適化本番実行 (apply: true)
        const optResult = await optimizeExistingImages({
            uploadsDir: testUploadsDir,
            db,
            maxWidth: 1200,
            quality: 80,
            apply: true
        });

        assert.strictEqual(optResult.success, true);
        assert.strictEqual(optResult.dryRun, false);
        assert.strictEqual(optResult.optimizedCount, 1);
        assert.ok(optResult.backupDir, 'バックアップディレクトリが生成されていること');
        assert.ok(fs.existsSync(optResult.backupDir), 'バックアップディレクトリが存在すること');

        // 新しいファイル名（-opt.jpg）が生成され、元ファイルは置換されていること（一本化）
        const newFileName = 'opt-target-opt.jpg';
        const newFilePath = path.join(testUploadsDir, newFileName);
        const newImageDbPath = `/uploads/${newFileName}`;
        assert.ok(fs.existsSync(newFilePath), '最適化後ファイルが存在すること');
        assert.ok(!fs.existsSync(originalPath), '元ファイルは新名に移行していること');

        // DBの全テーブルが新しいパスに更新されていること
        const updatedPart = await db.get('SELECT image_path, updated_at FROM parts WHERE id = ?', [partRes.lastID]);
        assert.strictEqual(updatedPart.image_path, newImageDbPath);
        // parts.updated_at が更新日時と一覧ソートを破壊しないよう、保持されていること
        assert.strictEqual(updatedPart.updated_at, fixedPastDate, 'parts.updated_atが更新されずに保持されていること');

        const updatedLoc = await db.get('SELECT image_path FROM locations WHERE id = ?', [locRes.lastID]);
        assert.strictEqual(updatedLoc.image_path, newImageDbPath);

        const updatedSug = await db.get('SELECT image_path FROM ai_name_suggestions WHERE part_id = ?', [partRes.lastID]);
        assert.strictEqual(updatedSug.image_path, newImageDbPath);

        // ロールバック実行 (指定ディレクトリ)
        const rollbackResult = await rollbackOptimization({
            uploadsDir: testUploadsDir,
            backupDir: optResult.backupDir,
            db
        });

        assert.strictEqual(rollbackResult.success, true);
        assert.strictEqual(rollbackResult.restoredFilesCount, 1);

        // 元ファイルが復元され、新ファイルが削除されていること
        assert.ok(fs.existsSync(originalPath), '元ファイルが復元されていること');
        assert.ok(!fs.existsSync(newFilePath), '最適化新ファイルが削除されていること');

        const restoredStat = await fs.promises.stat(originalPath);
        assert.strictEqual(restoredStat.size, largeBuffer.length, '元ファイルのバイト数が一致すること');

        // DBの全テーブルが元のパスに復元されていること
        const rolledBackPart = await db.get('SELECT image_path, updated_at FROM parts WHERE id = ?', [partRes.lastID]);
        assert.strictEqual(rolledBackPart.image_path, oldImageDbPath);
        assert.strictEqual(rolledBackPart.updated_at, fixedPastDate);

        const rolledBackLoc = await db.get('SELECT image_path FROM locations WHERE id = ?', [locRes.lastID]);
        assert.strictEqual(rolledBackLoc.image_path, oldImageDbPath);

        const rolledBackSug = await db.get('SELECT image_path FROM ai_name_suggestions WHERE part_id = ?', [partRes.lastID]);
        assert.strictEqual(rolledBackSug.image_path, oldImageDbPath);
    });
});
