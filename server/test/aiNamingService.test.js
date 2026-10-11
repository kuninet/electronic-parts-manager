const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { createTestDb, createDummyImage } = require('./testHelper');
const {
  ALLOWED_MODELS,
  AVAILABLE_MODELS,
  DEFAULT_MODEL,
  isValidModel,
  getDefaultModel,
  getAvailableModels,
  getCategoryList,
  checkDailyLimit,
  suggestPartName,
  applySuggestion,
  rejectSuggestion,
  getPendingSuggestions,
  sanitizeSingleLine,
  sanitizeDescription,
  sanitizeConfidence
} = require('../services/aiNaming');

test('AI Naming サービスの単体テスト', async (t) => {
  let db;
  let dummyImage;

  t.before(async () => {
    db = await createTestDb();
    dummyImage = await createDummyImage('test-service-part.jpg');
  });

  t.after(async () => {
    if (dummyImage && fs.existsSync(dummyImage.filePath)) {
      try { await fs.promises.unlink(dummyImage.filePath); } catch (e) {}
    }
  });

  await t.test('B3: モデル許可リストとヘルパー関数', async () => {
    assert.equal(getDefaultModel(), 'gemini-2.5-flash');
    assert.equal(isValidModel('gemini-2.5-flash'), true);
    assert.equal(isValidModel('gemini-2.5-pro'), true);
    assert.equal(isValidModel('invalid-custom-model'), false);
    assert.equal(isValidModel(''), false);
    assert.equal(isValidModel(null), false);

    const models = getAvailableModels();
    assert.equal(Array.isArray(models), true);
    assert.ok(models.every(m => ALLOWED_MODELS.includes(m.id)));

    // 無効なモデルを指定した場合に400エラーがスローされること
    await assert.rejects(
      async () => {
        await suggestPartName(1, { db, model: 'hacked-model' });
      },
      (err) => {
        assert.equal(err.status, 400);
        assert.equal(err.code, 'INVALID_MODEL');
        return true;
      }
    );
  });

  await t.test('M1: サニタイズとバリデーション関数のテスト', () => {
    // 改行の置換と文字数切り詰め
    assert.equal(
      sanitizeSingleLine('  ライン1\nライン2\r\nライン3  ', 20),
      'ライン1 ライン2 ライン3'
    );
    assert.equal(sanitizeSingleLine('1234567890ABCDEF', 10), '1234567890');
    assert.equal(sanitizeSingleLine(null, 10), '');

    // 説明文の切り詰め
    const longDesc = 'a'.repeat(400);
    assert.equal(sanitizeDescription(longDesc, 300).length, 300);

    // 信頼度のクランプ
    assert.equal(sanitizeConfidence(1.5), 1.0);
    assert.equal(sanitizeConfidence(-0.2), 0.0);
    assert.equal(sanitizeConfidence(0.85), 0.85);
    assert.equal(sanitizeConfidence('invalid'), 0.5);
  });

  await t.test('M5: カテゴリマスタの動的取得', async () => {
    await db.run("INSERT INTO categories (name, display_order) VALUES ('抵抗器', 1), ('IC', 2)");
    const list = await getCategoryList(db);
    assert.ok(list.includes('抵抗器'));
    assert.ok(list.includes('IC'));
  });

  await t.test('写真なし部品に対する suggestPartName はエラーをスローすること', async () => {
    const res = await db.run("INSERT INTO parts (name) VALUES ('(名称未設定)')");
    const partId = res.lastID;

    await assert.rejects(
      async () => {
        await suggestPartName(partId, { db, mockClient: {} });
      },
      (err) => {
        assert.equal(err.status, 400);
        assert.match(err.message, /写真が登録されていない/);
        return true;
      }
    );
  });

  await t.test('日次上限に達した場合に例外をスローすること', async () => {
    process.env.AI_NAMING_DAILY_LIMIT = '2';

    // 2件のダミー候補を挿入
    await db.run("INSERT INTO ai_name_suggestions (part_id, status) VALUES (1, 'pending')");
    await db.run("INSERT INTO ai_name_suggestions (part_id, status) VALUES (1, 'pending')");

    await assert.rejects(
      async () => {
        await checkDailyLimit(db);
      },
      (err) => {
        assert.equal(err.code, 'DAILY_LIMIT_EXCEEDED');
        return true;
      }
    );

    // リセット
    delete process.env.AI_NAMING_DAILY_LIMIT;
    await db.run("DELETE FROM ai_name_suggestions");
  });

  await t.test('モックClientを用いた suggestPartName の正常系', async () => {
    const partRes = await db.run(
      "INSERT INTO parts (name, image_path, quantity, qr_code) VALUES ('(名称未設定)', ?, 5, 'QR-001')",
      [dummyImage.imagePath]
    );
    const partId = partRes.lastID;

    const mockResponseText = JSON.stringify({
      suggested_name: '積層セラミックコンデンサ 0.1uF 50V',
      part_number: 'GRM188R71H104KA93D',
      manufacturer: 'Murata',
      package: '0603 (1608 Metric)',
      category_hint: 'Capacitors',
      markings: '104',
      description: 'デカップリング用積層セラミックコンデンサ',
      confidence: 0.95
    });

    const mockClient = {
      models: {
        generateContent: async () => ({
          text: mockResponseText
        })
      }
    };

    const suggestion = await suggestPartName(partId, {
      db,
      mockClient,
      model: 'gemini-2.5-flash',
      skipThrottle: true
    });

    assert.ok(suggestion);
    assert.equal(suggestion.part_id, partId);
    assert.equal(suggestion.status, 'pending');
    assert.equal(suggestion.suggested_name, '積層セラミックコンデンサ 0.1uF 50V');
    assert.equal(suggestion.part_number, 'GRM188R71H104KA93D');
    assert.equal(suggestion.confidence, 0.95);
    assert.equal(suggestion.markings, '104');

    // pending候補一覧の取得
    const pendingList = await getPendingSuggestions(db);
    assert.equal(pendingList.length, 1);
    assert.equal(pendingList[0].id, suggestion.id);
    assert.equal(pendingList[0].current_part_name, '(名称未設定)');
  });

  await t.test('B1: 再判定時に同一部品の既存 pending 候補が rejected に更新されること', async () => {
    const pendingListBefore = await getPendingSuggestions(db);
    const oldSuggestionId = pendingListBefore[0].id;
    const partId = pendingListBefore[0].part_id;

    const mockResponseText2 = JSON.stringify({
      suggested_name: '積層セラミックコンデンサ 0.1uF 50V (再判定版)',
      confidence: 0.98
    });

    const mockClient2 = {
      models: {
        generateContent: async () => ({
          text: mockResponseText2
        })
      }
    };

    const newSuggestion = await suggestPartName(partId, {
      db,
      mockClient: mockClient2,
      model: 'gemini-2.5-flash',
      force: true,
      skipThrottle: true
    });

    // 古い候補は rejected になっていること
    const oldRecord = await db.get('SELECT status FROM ai_name_suggestions WHERE id = ?', [oldSuggestionId]);
    assert.equal(oldRecord.status, 'rejected');

    // 新しい候補は pending
    assert.equal(newSuggestion.status, 'pending');
    assert.equal(newSuggestion.suggested_name, '積層セラミックコンデンサ 0.1uF 50V (再判定版)');

    // pending一覧には新候補のみが存在すること
    const pendingListAfter = await getPendingSuggestions(db);
    assert.equal(pendingListAfter.length, 1);
    assert.equal(pendingListAfter[0].id, newSuggestion.id);
  });

  await t.test('applySuggestion で名前が更新され、既存フィールド（QR、数量）が維持されること', async () => {
    const pendingList = await getPendingSuggestions(db);
    const suggestionId = pendingList[0].id;

    // カテゴリを1つ準備
    const catRes = await db.run("INSERT INTO categories (name) VALUES ('Capacitors')");
    const catId = catRes.lastID;

    const result = await applySuggestion(suggestionId, {
      db,
      name: '積層セラミックコンデンサ 0.1uF 50V (編集済)',
      category_id: catId
    });

    assert.equal(result.suggestion.status, 'applied');
    assert.equal(result.part.name, '積層セラミックコンデンサ 0.1uF 50V (編集済)');
    assert.equal(result.part.category_id, catId);
    assert.equal(result.part.quantity, 5); // 数量が保持されていること
    assert.equal(result.part.qr_code, 'QR-001'); // QRコードが保持されていること
  });

  await t.test('B2: 既に applied または rejected になった候補の再採用が 409 で拒否されること', async () => {
    // 直前のテストで applied になった suggestionId
    const appliedRecord = await db.get('SELECT id FROM ai_name_suggestions WHERE status = "applied" LIMIT 1');

    await assert.rejects(
      async () => {
        await applySuggestion(appliedRecord.id, { db });
      },
      (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, 'INVALID_STATUS');
        assert.match(err.message, /既に処理済みか無効です/);
        return true;
      }
    );
  });

  await t.test('写真が変更された場合、applySuggestion が IMAGE_MISMATCH エラーを返すこと', async () => {
    // 新しい部品と候補を作成
    const pRes = await db.run(
      "INSERT INTO parts (name, image_path) VALUES ('(カメラ登録)', ?)",
      [dummyImage.imagePath]
    );
    const partId = pRes.lastID;

    const sRes = await db.run(
      "INSERT INTO ai_name_suggestions (part_id, image_path, suggested_name, status) VALUES (?, ?, 'テスト候補', 'pending')",
      [partId, dummyImage.imagePath]
    );
    const suggestionId = sRes.lastID;

    // 写真を変更
    await db.run("UPDATE parts SET image_path = '/uploads/new-photo.jpg' WHERE id = ?", [partId]);

    await assert.rejects(
      async () => {
        await applySuggestion(suggestionId, { db });
      },
      (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, 'IMAGE_MISMATCH');
        return true;
      }
    );
  });

  await t.test('rejectSuggestion で status が rejected に更新されること', async () => {
    const sRes = await db.run(
      "INSERT INTO ai_name_suggestions (part_id, suggested_name, status) VALUES (1, '却下対象候補', 'pending')"
    );
    const suggestionId = sRes.lastID;

    const rejected = await rejectSuggestion(suggestionId, { db });
    assert.equal(rejected.status, 'rejected');
  });

  await t.test('M2: 401 や 429 エラー発生時にエラーレコードがDBに記録されないこと', async () => {
    const pRes = await db.run("INSERT INTO parts (name, image_path) VALUES ('(名称未設定)', ?)", [dummyImage.imagePath]);
    const partId = pRes.lastID;

    const countBefore = await db.get("SELECT COUNT(*) as count FROM ai_name_suggestions");

    const mock429Client = {
      models: {
        generateContent: async () => {
          const err = new Error('Resource exhausted 429');
          err.status = 429;
          throw err;
        }
      }
    };

    await assert.rejects(
      async () => {
        await suggestPartName(partId, {
          db,
          mockClient: mock429Client,
          model: 'gemini-2.5-flash',
          skipThrottle: true
        });
      },
      (err) => {
        assert.equal(err.status, 429);
        return true;
      }
    );

    const countAfter = await db.get("SELECT COUNT(*) as count FROM ai_name_suggestions");
    // レコード数が増えていないこと（日次上限カウントの消費防止）
    assert.equal(countAfter.count, countBefore.count);
  });

  await t.test('APIキー無効（API_KEY_INVALID）時にエラーレコードがDBに記録されないこと', async () => {
    const pRes = await db.run("INSERT INTO parts (name, image_path) VALUES ('(名称未設定) キー無効テスト', ?)", [dummyImage.imagePath]);
    const partId = pRes.lastID;

    const countBefore = await db.get("SELECT COUNT(*) as count FROM ai_name_suggestions");

    const mockApiKeyInvalidClient = {
      models: {
        generateContent: async () => {
          const err = new Error('API key not valid. Please pass a valid API key. [API_KEY_INVALID]');
          err.status = 400;
          throw err;
        }
      }
    };

    await assert.rejects(
      async () => {
        await suggestPartName(partId, {
          db,
          mockClient: mockApiKeyInvalidClient,
          model: 'gemini-2.5-flash',
          skipThrottle: true
        });
      },
      (err) => {
        assert.equal(err.status, 400);
        assert.equal(err.code, 'API_KEY_INVALID');
        return true;
      }
    );

    const countAfter = await db.get("SELECT COUNT(*) as count FROM ai_name_suggestions");
    assert.equal(countAfter.count, countBefore.count);
  });

  await t.test('画像前処理エラー発生時にエラーレコードがDBに記録されないこと', async () => {
    const pRes = await db.run("INSERT INTO parts (name, image_path) VALUES ('(名称未設定) 画像エラーテスト', '/uploads/non-existent-img-xyz.jpg')");
    const partId = pRes.lastID;

    const countBefore = await db.get("SELECT COUNT(*) as count FROM ai_name_suggestions");

    await assert.rejects(
      async () => {
        await suggestPartName(partId, {
          db,
          mockClient: {},
          model: 'gemini-2.5-flash',
          skipThrottle: true
        });
      },
      (err) => {
        assert.equal(err.status, 400);
        assert.equal(err.code, 'IMAGE_PREPARE_ERROR');
        return true;
      }
    );

    const countAfter = await db.get("SELECT COUNT(*) as count FROM ai_name_suggestions");
    assert.equal(countAfter.count, countBefore.count);
  });
});
