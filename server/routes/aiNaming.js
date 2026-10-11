const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const {
  isAiNamingEnabled,
  getDefaultModel,
  getAvailableModels,
  getTodayExecutionCount,
  checkDailyLimit,
  suggestPartName,
  applySuggestion,
  rejectSuggestion,
  getPendingSuggestions
} = require('../services/aiNaming');

// GET /api/ai-naming/status - 機能有効状態、本日件数、日次上限、デフォルトモデル
router.get('/status', async (req, res) => {
  try {
    const db = getDb();
    const enabled = isAiNamingEnabled();
    const todayCount = await getTodayExecutionCount(db);
    const dailyLimit = parseInt(process.env.AI_NAMING_DAILY_LIMIT, 10) || 200;
    const defaultModel = getDefaultModel();

    res.json({
      enabled,
      todayCount,
      dailyLimit,
      defaultModel
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ai-naming/models - 利用可能モデル一覧
router.get('/models', (req, res) => {
  try {
    const models = getAvailableModels();
    res.json(models);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ai-naming/suggestions - pending候補一覧
router.get('/suggestions', async (req, res) => {
  try {
    const db = getDb();
    const suggestions = await getPendingSuggestions(db);
    res.json(suggestions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai-naming/suggest/:id - 単一部品の判定
router.post('/suggest/:id', async (req, res) => {
  try {
    const { model, force } = req.body;
    const suggestion = await suggestPartName(req.params.id, {
      model,
      force: Boolean(force)
    });
    res.json(suggestion);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({
      error: err.message,
      code: err.code || 'AI_NAMING_ERROR',
      record: err.record || null
    });
  }
});

// POST /api/ai-naming/apply/:id - 候補の採用（写真変更チェック付き）
router.post('/apply/:id', async (req, res) => {
  try {
    const { name, category_id, apply_category } = req.body;
    const result = await applySuggestion(req.params.id, {
      name,
      category_id,
      apply_category
    });
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({
      error: err.message,
      code: err.code || 'APPLY_ERROR'
    });
  }
});

// POST /api/ai-naming/apply-batch - 一括採用
router.post('/apply-batch', async (req, res) => {
  try {
    const db = getDb();
    const { items, suggestion_ids, min_confidence, apply_category } = req.body;

    let targets = []; // 各要素: { id, name, category_id, apply_category }

    if (Array.isArray(items) && items.length > 0) {
      // M4: 手直しされた名前・個別設定を含む items 配列
      targets = items.map(item => ({
        id: item.id,
        name: item.name,
        category_id: item.category_id,
        apply_category: item.apply_category !== undefined ? item.apply_category : apply_category
      }));
    } else if (Array.isArray(suggestion_ids) && suggestion_ids.length > 0) {
      targets = suggestion_ids.map(id => ({ id, apply_category }));
    } else if (typeof min_confidence === 'number') {
      const candidates = await db.all(
        'SELECT id FROM ai_name_suggestions WHERE status = "pending" AND confidence >= ?',
        [min_confidence]
      );
      targets = candidates.map(c => ({ id: c.id, apply_category }));
    } else {
      return res.status(400).json({ error: 'items, suggestion_ids, または min_confidence を指定してください' });
    }

    const applied = [];
    const skipped = [];

    for (const target of targets) {
      try {
        const resApply = await applySuggestion(target.id, {
          name: target.name,
          category_id: target.category_id,
          apply_category: target.apply_category
        });
        applied.push(resApply);
      } catch (err) {
        skipped.push({ id: target.id, error: err.message, code: err.code });
      }
    }

    res.json({
      total: targets.length,
      appliedCount: applied.length,
      skippedCount: skipped.length,
      applied,
      skipped
    });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message, code: err.code || 'APPLY_BATCH_ERROR' });
  }
});

// POST /api/ai-naming/reject/:id - 候補の却下
router.post('/reject/:id', async (req, res) => {
  try {
    const result = await rejectSuggestion(req.params.id);
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({
      error: err.message,
      code: err.code || 'REJECT_ERROR'
    });
  }
});

// POST /api/ai-naming/reject-batch - 候補の一括却下
router.post('/reject-batch', async (req, res) => {
  try {
    const { suggestion_ids } = req.body;
    if (!Array.isArray(suggestion_ids) || suggestion_ids.length === 0) {
      return res.status(400).json({ error: 'suggestion_ids 配列を指定してください' });
    }

    const rejected = [];
    for (const id of suggestion_ids) {
      try {
        const resReject = await rejectSuggestion(id);
        rejected.push(resReject);
      } catch (e) {
        // スキップ
      }
    }

    res.json({
      total: suggestion_ids.length,
      rejectedCount: rejected.length,
      rejected
    });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
