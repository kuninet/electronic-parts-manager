/**
 * 既存画像一括最適化スクリプト
 * 
 * uploads/ ディレクトリ内の既存画像を走査し、長辺最大1200px・JPEG品質80%でリサイズ・最適化します。
 * デフォルトは安全のため「ドライラン（dry-run）」として動作します。
 * 実際に最適化を実行する場合は --apply フラグを指定してください。
 * 静的配信・CDNキャッシュ対策のため、すべて新ファイル名（-optサフィックス）でのリネーム保存およびDBトランザクション更新を行います。
 * --rollback [dir] オプションで直前（または指定）のバックアップから元画像とDB状態を復元できます。
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

const TARGET_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const SKIP_FILE_SIZE_LIMIT = 500 * 1024; // 500KB

/**
 * SQLiteデータベース接続を取得
 */
async function getDatabase(dbPath) {
    const resolvedDbPath = dbPath || process.env.DB_PATH || path.resolve(__dirname, '../database.sqlite');
    const db = await open({
        filename: resolvedDbPath,
        driver: sqlite3.Database
    });
    await db.run('PRAGMA foreign_keys = ON');
    return db;
}

/**
 * 単一画像をsharpで最適化処理
 */
async function processImageBuffer(inputBuffer, ext, maxWidth = 1200, quality = 80) {
    const metadata = await sharp(inputBuffer).metadata();
    let pipeline = sharp(inputBuffer).rotate();

    const origWidth = metadata.width || 0;
    const origHeight = metadata.height || 0;
    const maxDim = Math.max(origWidth, origHeight);

    if (maxDim > maxWidth) {
        if (origWidth >= origHeight) {
            pipeline = pipeline.resize({ width: maxWidth, withoutEnlargement: true });
        } else {
            pipeline = pipeline.resize({ height: maxWidth, withoutEnlargement: true });
        }
    }

    const normalizedExt = ext.toLowerCase();
    if (normalizedExt === '.jpg' || normalizedExt === '.jpeg') {
        pipeline = pipeline.jpeg({ quality, mozjpeg: true });
    } else if (normalizedExt === '.png') {
        pipeline = pipeline.png({ quality, compressionLevel: 8 });
    } else if (normalizedExt === '.webp') {
        pipeline = pipeline.webp({ quality });
    }

    const outputBuffer = await pipeline.toBuffer();
    const newMeta = await sharp(outputBuffer).metadata();

    return {
        outputBuffer,
        origWidth,
        origHeight,
        newWidth: newMeta.width,
        newHeight: newMeta.height,
        origSize: inputBuffer.length,
        newSize: outputBuffer.length
    };
}

/**
 * DB内の画像参照レコードを検索
 */
async function findDbReferences(db, imagePath) {
    const references = [];
    if (!db) return references;

    try {
        const parts = await db.all('SELECT id, name FROM parts WHERE image_path = ?', [imagePath]);
        for (const p of parts) {
            references.push({ table: 'parts', id: p.id, name: p.name });
        }
    } catch (e) { }

    try {
        const locs = await db.all('SELECT id, name FROM locations WHERE image_path = ?', [imagePath]);
        for (const l of locs) {
            references.push({ table: 'locations', id: l.id, name: l.name });
        }
    } catch (e) { }

    try {
        const sugs = await db.all('SELECT id, suggested_name FROM ai_name_suggestions WHERE image_path = ?', [imagePath]);
        for (const s of sugs) {
            references.push({ table: 'ai_name_suggestions', id: s.id, name: s.suggested_name });
        }
    } catch (e) { }

    return references;
}

/**
 * 既存画像の一括最適化を実行
 */
async function optimizeExistingImages(options = {}) {
    const {
        uploadsDir = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads'),
        db = null,
        dbPath = null,
        maxWidth = 1200,
        quality = 80,
        apply = false,
        backupDir = null
    } = options;

    // 安全第一: dryRunオプションが明示されていない場合は apply: true のときのみ本番実行
    const isDryRun = options.dryRun !== undefined ? options.dryRun : !apply;

    if (!fs.existsSync(uploadsDir)) {
        return {
            success: false,
            message: `アップロード先ディレクトリが存在しません: ${uploadsDir}`,
            processedCount: 0,
            optimizedCount: 0,
            totalSavedBytes: 0
        };
    }

    let database = db;
    let ownDb = false;
    const resolvedDbPath = dbPath || process.env.DB_PATH || path.resolve(__dirname, '../database.sqlite');
    if (!database) {
        try {
            database = await getDatabase(resolvedDbPath);
            ownDb = true;
        } catch (err) {
            console.warn('DB接続なしでファイル最適化のみを実行します:', err.message);
        }
    }

    const files = await fs.promises.readdir(uploadsDir);
    const candidateFiles = files.filter(f => {
        if (f.startsWith('.') || f.startsWith('backup')) return false;
        const ext = path.extname(f).toLowerCase();
        return TARGET_EXTENSIONS.includes(ext);
    });

    const executionId = new Date().toISOString().replace(/[:.]/g, '-');
    const defaultBackupsBaseDir = path.join(__dirname, '../backups/images');
    const resolvedBackupDir = backupDir || path.join(defaultBackupsBaseDir, executionId);

    // 本番実行時（dry-runでない場合）、バックアップディレクトリとDBスナップショットを作成
    if (!isDryRun) {
        await fs.promises.mkdir(resolvedBackupDir, { recursive: true });
        // SQLite DB スナップショットバックアップ作成
        if (fs.existsSync(resolvedDbPath)) {
            const dbBackupPath = path.join(resolvedBackupDir, 'database.sqlite.bak');
            try {
                await fs.promises.copyFile(resolvedDbPath, dbBackupPath);
            } catch (err) {
                console.warn('DBスナップショット作成スキップ:', err.message);
            }
        }
    }

    const manifest = {
        timestamp: new Date().toISOString(),
        executionId,
        uploadsDir,
        backupDir: resolvedBackupDir,
        maxWidth,
        quality,
        files: []
    };

    let totalOriginalBytes = 0;
    let totalOptimizedBytes = 0;
    let processedFilesCount = 0;
    const targetList = [];

    // 1ファイルずつ逐次処理（メモリ過剰消費を防止）
    for (const file of candidateFiles) {
        const filePath = path.join(uploadsDir, file);
        const stat = await fs.promises.stat(filePath);
        if (!stat.isFile()) continue;

        const ext = path.extname(file);
        const base = path.basename(file, ext);

        // すでに本スクリプトで最適化リネーム済みの画像（-opt）は二重処理を防ぐためスキップ
        if (base.endsWith('-opt')) {
            continue;
        }

        processedFilesCount++;
        const imageDbPath = `/uploads/${file}`;

        try {
            // メタデータのみ先に軽量チェック
            const metadata = await sharp(filePath).metadata();
            const origWidth = metadata.width || 0;
            const origHeight = metadata.height || 0;
            const maxDim = Math.max(origWidth, origHeight);

            // スキップ条件: 長辺がmaxWidth(1200px)以下 かつ ファイルサイズが500KB以下
            if (maxDim <= maxWidth && stat.size <= SKIP_FILE_SIZE_LIMIT) {
                totalOriginalBytes += stat.size;
                totalOptimizedBytes += stat.size;
                continue;
            }

            // バッファを読み込んで最適化を試行
            const inputBuffer = await fs.promises.readFile(filePath);
            const processResult = await processImageBuffer(inputBuffer, ext, maxWidth, quality);

            const sizeReduced = processResult.newSize < processResult.origSize;
            const dimensionReduced = origWidth > maxWidth || origHeight > maxWidth;
            const needsOptimization = sizeReduced || dimensionReduced;

            if (!needsOptimization) {
                totalOriginalBytes += processResult.origSize;
                totalOptimizedBytes += processResult.origSize;
                continue;
            }

            let references = [];
            if (database) {
                references = await findDbReferences(database, imageDbPath);
            }

            const itemInfo = {
                fileName: file,
                filePath,
                imageDbPath,
                origSize: processResult.origSize,
                newSize: processResult.newSize,
                savedBytes: processResult.origSize - processResult.newSize,
                origWidth: processResult.origWidth,
                origHeight: processResult.origHeight,
                newWidth: processResult.newWidth,
                newHeight: processResult.newHeight,
                references
            };

            totalOriginalBytes += processResult.origSize;
            totalOptimizedBytes += processResult.newSize;
            targetList.push(itemInfo);

            if (isDryRun) {
                continue;
            }

            // --- アトミック配置順序（リネーム方式に完全一本化） ---
            // キャッシュ対策のため、必ず新ファイル名（-optサフィックス）で保存
            const newFileName = `${base}-opt${ext}`;
            const finalFilePath = path.join(uploadsDir, newFileName);
            const finalDbPath = `/uploads/${newFileName}`;
            const backupFilePath = path.join(resolvedBackupDir, file);

            // ステップ1: 一時ファイルに最適化後画像を保存
            const tempFilePath = `${finalFilePath}.tmp-${Date.now()}`;
            await fs.promises.writeFile(tempFilePath, processResult.outputBuffer);

            // ステップ2: 新ファイルを正式名で配置
            await fs.promises.rename(tempFilePath, finalFilePath);

            // ステップ3: DBトランザクションコミット（parts.updated_atは更新しない）
            if (database) {
                await database.run('BEGIN TRANSACTION');
                try {
                    await database.run(
                        'UPDATE parts SET image_path = ? WHERE image_path = ?',
                        [finalDbPath, imageDbPath]
                    );
                    await database.run(
                        'UPDATE locations SET image_path = ? WHERE image_path = ?',
                        [finalDbPath, imageDbPath]
                    );
                    await database.run(
                        'UPDATE ai_name_suggestions SET image_path = ? WHERE image_path = ?',
                        [finalDbPath, imageDbPath]
                    );
                    await database.run('COMMIT');
                } catch (dbErr) {
                    await database.run('ROLLBACK');
                    // DB失敗時は配置した新ファイルを削除してロールバック
                    if (fs.existsSync(finalFilePath)) {
                        await fs.promises.unlink(finalFilePath);
                    }
                    throw dbErr;
                }
            }

            // ステップ4: DBコミット成功後に元ファイルをバックアップへ移動
            await fs.promises.copyFile(filePath, backupFilePath);
            if (fs.existsSync(filePath)) {
                await fs.promises.unlink(filePath);
            }

            // ステップ5: マニフェスト追記
            manifest.files.push({
                originalFileName: file,
                backupFileName: file,
                originalFilePath: filePath,
                finalFilePath,
                oldDbPath: imageDbPath,
                newDbPath: finalDbPath,
                origSize: itemInfo.origSize,
                newSize: itemInfo.newSize,
                references
            });

            // 逐次マニフェスト保存（クラッシュ時にも追跡可能）
            await fs.promises.writeFile(
                path.join(resolvedBackupDir, 'backup-manifest.json'),
                JSON.stringify(manifest, null, 2),
                'utf-8'
            );

        } catch (err) {
            console.error(`画像スキップ (エラー): ${file}`, err.message);
        }
    }

    if (ownDb && database) {
        await database.close();
    }

    const totalSavedBytes = Math.max(0, totalOriginalBytes - totalOptimizedBytes);

    return {
        success: true,
        dryRun: isDryRun,
        backupDir: isDryRun ? null : resolvedBackupDir,
        totalFiles: processedFilesCount,
        targetCount: targetList.length,
        optimizedCount: isDryRun ? 0 : targetList.length,
        totalOriginalBytes,
        totalOptimizedBytes,
        totalSavedBytes,
        targets: targetList
    };
}

/**
 * バックアップからのロールバック実行
 */
async function rollbackOptimization(options = {}) {
    const {
        uploadsDir = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads'),
        backupDir = null,
        db = null,
        dbPath = null
    } = options;

    let targetBackupDir = backupDir;

    // backupDirが未指定の場合は server/backups/images 内の最新ディレクトリを検索
    if (!targetBackupDir) {
        const defaultBackupsBaseDir = path.join(__dirname, '../backups/images');
        if (fs.existsSync(defaultBackupsBaseDir)) {
            const entries = await fs.promises.readdir(defaultBackupsBaseDir);
            const backupDirs = entries
                .map(e => path.join(defaultBackupsBaseDir, e))
                .filter(p => fs.statSync(p).isDirectory())
                .sort()
                .reverse();
            if (backupDirs.length > 0) {
                targetBackupDir = backupDirs[0];
            }
        }

        // 旧仕様の uploads/.backup-* もフォールバックとして検索
        if (!targetBackupDir && fs.existsSync(uploadsDir)) {
            const entries = await fs.promises.readdir(uploadsDir);
            const backupDirs = entries
                .filter(e => e.startsWith('.backup-'))
                .map(e => path.join(uploadsDir, e))
                .sort()
                .reverse();
            if (backupDirs.length > 0) {
                targetBackupDir = backupDirs[0];
            }
        }

        if (!targetBackupDir) {
            throw new Error('復元可能なバックアップが見つかりません');
        }
    }

    const manifestPath = path.join(targetBackupDir, 'backup-manifest.json');
    if (!fs.existsSync(manifestPath)) {
        throw new Error(`バックアップマニフェストが存在しません: ${manifestPath}`);
    }

    const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf-8'));

    let database = db;
    let ownDb = false;
    const resolvedDbPath = dbPath || process.env.DB_PATH || path.resolve(__dirname, '../database.sqlite');
    if (!database) {
        try {
            database = await getDatabase(resolvedDbPath);
            ownDb = true;
        } catch (err) {
            console.warn('DB接続なしでファイル復元のみを実行します:', err.message);
        }
    }

    if (database) {
        await database.run('BEGIN TRANSACTION');
    }

    try {
        for (const fileItem of manifest.files) {
            const backupFile = path.join(targetBackupDir, fileItem.backupFileName);
            const restoreTarget = fileItem.originalFilePath;

            // 新ファイルを削除
            if (fs.existsSync(fileItem.finalFilePath)) {
                await fs.promises.unlink(fileItem.finalFilePath);
            }

            // 元ファイルを復元
            if (fs.existsSync(backupFile)) {
                await fs.promises.copyFile(backupFile, restoreTarget);
            }

            // DBパスの復元（parts.updated_at は変更しない）
            if (database && fileItem.newDbPath !== fileItem.oldDbPath) {
                await database.run(
                    'UPDATE parts SET image_path = ? WHERE image_path = ?',
                    [fileItem.oldDbPath, fileItem.newDbPath]
                );
                await database.run(
                    'UPDATE locations SET image_path = ? WHERE image_path = ?',
                    [fileItem.oldDbPath, fileItem.newDbPath]
                );
                await database.run(
                    'UPDATE ai_name_suggestions SET image_path = ? WHERE image_path = ?',
                    [fileItem.oldDbPath, fileItem.newDbPath]
                );
            }
        }

        if (database) {
            await database.run('COMMIT');
        }
    } catch (err) {
        if (database) {
            await database.run('ROLLBACK');
        }
        throw err;
    } finally {
        if (ownDb && database) {
            await database.close();
        }
    }

    return {
        success: true,
        restoredFilesCount: manifest.files.length,
        backupDir: targetBackupDir
    };
}

/**
 * CLI実行用エントリーポイント
 */
async function main() {
    const args = process.argv.slice(2);
    const rollback = args.includes('--rollback');
    const apply = args.includes('--apply');
    const dryRunExplicit = args.includes('--dry-run');

    // 安全第一: --apply が明示されない限り、常にドライランとして実行
    const isDryRun = dryRunExplicit || !apply;

    let maxWidth = 1200;
    const maxWidthIdx = args.indexOf('--max-width');
    if (maxWidthIdx !== -1 && args[maxWidthIdx + 1]) {
        maxWidth = parseInt(args[maxWidthIdx + 1], 10);
    }

    let quality = 80;
    const qualityIdx = args.indexOf('--quality');
    if (qualityIdx !== -1 && args[qualityIdx + 1]) {
        quality = parseInt(args[qualityIdx + 1], 10);
    }

    let customBackupDir = null;
    const backupDirIdx = args.indexOf('--backup-dir');
    if (backupDirIdx !== -1 && args[backupDirIdx + 1]) {
        customBackupDir = args[backupDirIdx + 1];
    } else if (rollback) {
        const rollbackIdx = args.indexOf('--rollback');
        if (args[rollbackIdx + 1] && !args[rollbackIdx + 1].startsWith('--')) {
            customBackupDir = args[rollbackIdx + 1];
        }
    }

    if (rollback) {
        console.log('--- 画像ロールバック処理を開始します ---');
        try {
            const res = await rollbackOptimization({ backupDir: customBackupDir });
            console.log(`✅ ロールバック完了: ${res.restoredFilesCount} 件の画像を復元しました (バックアップ元: ${res.backupDir})`);
        } catch (err) {
            console.error('❌ ロールバック失敗:', err.message);
            process.exit(1);
        }
        return;
    }

    console.log(`--- 既存画像一括最適化処理を開始します ${isDryRun ? '(DRY-RUN / プレビューモード)' : '(APPLY / 本番適用モード)'} ---`);
    console.log(`設定: 長辺最大=${maxWidth}px, 品質=${quality}%`);
    if (isDryRun) {
        console.log('※ 安全のためドライランとして動作しています。実際の最適化を実行するには --apply を指定してください。');
    }

    try {
        const res = await optimizeExistingImages({
            dryRun: isDryRun,
            apply: !isDryRun,
            maxWidth,
            quality,
            backupDir: customBackupDir
        });

        if (res.dryRun) {
            console.log(`\n走査完了: 全 ${res.totalFiles} ファイル中、${res.targetCount} ファイルが最適化対象です。`);
            console.log(`予測削減容量: ${(res.totalSavedBytes / (1024 * 1024)).toFixed(2)} MB (${((res.totalSavedBytes / (res.totalOriginalBytes || 1)) * 100).toFixed(1)}% 削減)`);
            console.log('\n--- 最適化対象一覧 ---');
            for (const t of res.targets) {
                const origKb = (t.origSize / 1024).toFixed(1);
                const newKb = (t.newSize / 1024).toFixed(1);
                const refStr = t.references.length > 0
                    ? t.references.map(r => `${r.table}#${r.id}`).join(', ')
                    : 'DB参照なし';
                console.log(`• ${t.fileName}: ${t.origWidth}x${t.origHeight} (${origKb} KB) -> ${t.newWidth}x${t.newHeight} (${newKb} KB) [${refStr}]`);
            }
            console.log('\n※ ドライランのためファイルおよびDBの変更は行われていません。');
            console.log('本番適用するには: npm run optimize-images -- --apply');
        } else {
            console.log(`\n✅ 最適化完了: ${res.optimizedCount} 件の画像を最適化・リネーム保存しました。`);
            console.log(`削減容量: ${(res.totalSavedBytes / (1024 * 1024)).toFixed(2)} MB`);
            if (res.backupDir) {
                console.log(`バックアップ保存先: ${res.backupDir}`);
            }
        }
    } catch (err) {
        console.error('❌ 最適化エラー:', err);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    optimizeExistingImages,
    rollbackOptimization,
    processImageBuffer,
    findDbReferences
};
