<script setup>
import { ref, onMounted, computed } from 'vue';
import api from '../api';
import { useToast } from '../composables/useToast';

const toast = useToast();

const props = defineProps({
  show: {
    type: Boolean,
    default: true
  }
});

const emit = defineEmits(['close', 'updated']);

const suggestions = ref([]);
const loading = ref(true);
const processingId = ref(null);
const batchProcessing = ref(false);
const error = ref(null);

const resolveImageUrl = (imagePath) => {
  if (!imagePath) return '';
  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) return imagePath;
  const baseUrl = import.meta.env.VITE_API_URL || '';
  return `${baseUrl}${imagePath}`;
};

const highConfidenceCount = computed(() => {
  return suggestions.value.filter(s => (s.confidence || 0) >= 0.8 && !isImageMismatched(s)).length;
});

const isImageMismatched = (s) => {
  return Boolean(s.current_part_image_path && s.image_path !== s.current_part_image_path);
};

const fetchSuggestions = async () => {
  loading.value = true;
  error.value = null;
  try {
    const res = await api.get('/ai-naming/suggestions');
    suggestions.value = res.data.map(item => ({
      ...item,
      edit_name: item.suggested_name || '',
      edit_part_number: item.current_part_number ? item.current_part_number : (item.part_number || ''),
      // 既存カテゴリの上書き防止: 既に手動でカテゴリ設定済みの部品はデフォルトOFF、未設定のみON
      apply_category: !item.current_category_id && !item.category_id && !item.current_category_name
    }));
  } catch (err) {
    console.error('候補の取得に失敗しました', err);
    error.value = '判定候補の取得に失敗しました';
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  fetchSuggestions();
});

// 個別採用
const handleApply = async (s) => {
  if (!s.edit_name || !s.edit_name.trim()) {
    toast.warning('部品名を入力してください');
    return;
  }
  processingId.value = s.id;
  try {
    await api.post(`/ai-naming/apply/${s.id}`, {
      name: s.edit_name.trim(),
      part_number: (s.edit_part_number || '').trim(),
      apply_category: s.apply_category
    });
    suggestions.value = suggestions.value.filter(item => item.id !== s.id);
    toast.success('候補を採用しました');
    emit('updated');
  } catch (err) {
    console.error('採用処理に失敗しました', err);
    toast.error(err.response?.data?.error || '採用処理に失敗しました');
  } finally {
    processingId.value = null;
  }
};

// 個別却下
const handleReject = async (s) => {
  processingId.value = s.id;
  try {
    await api.post(`/ai-naming/reject/${s.id}`);
    suggestions.value = suggestions.value.filter(item => item.id !== s.id);
    toast.info('候補を却下しました');
    emit('updated');
  } catch (err) {
    console.error('却下処理に失敗しました', err);
    toast.error(err.response?.data?.error || '却下処理に失敗しました');
  } finally {
    processingId.value = null;
  }
};

// 個別再判定
const handleResuggest = async (s) => {
  processingId.value = s.id;
  try {
    const res = await api.post(`/ai-naming/suggest/${s.part_id}`, {
      model: s.model,
      force: true
    });
    // 新しい候補で置き換え
    const updated = {
      ...res.data,
      current_part_name: s.current_part_name,
      current_part_number: s.current_part_number,
      current_part_image_path: s.current_part_image_path,
      current_category_id: s.current_category_id,
      current_category_name: s.current_category_name,
      edit_name: res.data.suggested_name || '',
      edit_part_number: s.current_part_number ? s.current_part_number : (res.data.part_number || ''),
      apply_category: !s.current_category_id && !s.category_id && !s.current_category_name
    };
    const index = suggestions.value.findIndex(item => item.id === s.id);
    if (index !== -1) {
      suggestions.value[index] = updated;
    }
    toast.success('再判定が完了しました');
    emit('updated');
  } catch (err) {
    console.error('再判定に失敗しました', err);
    toast.error(err.response?.data?.error || '再判定に失敗しました');
  } finally {
    processingId.value = null;
  }
};

// 信頼度0.8以上を一括採用（M4: 手直し名前・個別設定の保持）
const handleApplyHighConfidence = async () => {
  const targets = suggestions.value.filter(s => (s.confidence || 0) >= 0.8 && !isImageMismatched(s));
  if (targets.length === 0) return;
  if (!confirm(`信頼度0.8以上の候補（${targets.length}件）を一括採用しますか？`)) return;

  batchProcessing.value = true;
  try {
    const items = targets.map(s => ({
      id: s.id,
      name: s.edit_name && s.edit_name.trim() ? s.edit_name.trim() : s.suggested_name,
      part_number: (s.edit_part_number || '').trim(),
      apply_category: s.apply_category
    }));

    const res = await api.post('/ai-naming/apply-batch', { items });
    toast.success(`${res.data.appliedCount}件の候補を採用しました`);
    await fetchSuggestions();
    emit('updated');
  } catch (err) {
    console.error('一括採用に失敗しました', err);
    toast.error(err.response?.data?.error || '一括採用に失敗しました');
  } finally {
    batchProcessing.value = false;
  }
};

const getConfidenceBadgeClass = (confidence) => {
  const conf = Number(confidence) || 0;
  if (conf >= 0.8) return 'badge-high';
  if (conf >= 0.5) return 'badge-mid';
  return 'badge-low';
};
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-content glass-panel">
      <div class="modal-header">
        <div class="header-title-row">
          <h2>📋 AI判定候補の確認 ({{ suggestions.length }}件)</h2>
          <span class="header-subtitle">AIが写真から推定した部品名を確認・編集して採用できます</span>
        </div>
        <button class="btn-icon" @click="$emit('close')" title="閉じる">❌</button>
      </div>

      <div class="modal-actions-bar">
        <button
          class="btn btn-primary apply-high-btn"
          :disabled="highConfidenceCount === 0 || batchProcessing"
          @click="handleApplyHighConfidence"
        >
          ✨ 信頼度0.8以上を一括採用 ({{ highConfidenceCount }}件)
        </button>
        <button class="btn btn-secondary" @click="fetchSuggestions" :disabled="loading">
          🔄 最新に更新
        </button>
      </div>

      <div class="modal-body">
        <div v-if="loading" class="state-message">
          <div class="loading-spinner">⏳</div>
          <p>候補を読み込み中...</p>
        </div>

        <div v-else-if="error" class="state-message error-message">
          <p>{{ error }}</p>
          <button class="btn btn-secondary mt-2" @click="fetchSuggestions">再試行</button>
        </div>

        <div v-else-if="suggestions.length === 0" class="state-message empty-message">
          <p>🎉 現在保留中のAI判定候補はありません</p>
          <p class="subtext">部品一覧から「AIで部品名を判定」を実行するとここに候補が表示されます。</p>
        </div>

        <div v-else class="suggestion-list">
          <div
            v-for="s in suggestions"
            :key="s.id"
            class="suggestion-card glass-panel"
            :class="{ 'mismatch': isImageMismatched(s) }"
          >
            <!-- 画像セクション -->
            <div class="card-image-col">
              <img
                v-if="s.image_path"
                :src="resolveImageUrl(s.image_path)"
                alt="部品写真"
                class="thumb-img"
              />
              <div v-else class="no-img-box">No Image</div>
              <span class="model-badge" :title="'使用モデル: ' + s.model">{{ s.model }}</span>
            </div>

            <!-- 詳細セクション -->
            <div class="card-details-col">
              <div class="card-top-info">
                <div class="orig-name">
                  <span class="orig-label">元の名称:</span>
                  <span class="orig-val">{{ s.current_part_name }}</span>
                </div>
                <div class="confidence-badge" :class="getConfidenceBadgeClass(s.confidence)">
                  信頼度: {{ Math.round((s.confidence || 0) * 100) }}%
                </div>
              </div>

              <!-- 写真変更警告 -->
              <div v-if="isImageMismatched(s)" class="alert-box-warning">
                ⚠️ 判定時から部品の写真が変更されたため採用できません。再判定してください。
              </div>

              <!-- 判定名の編集 -->
              <div class="form-row-name">
                <label class="field-label">AI判定名 (編集可):</label>
                <input
                  v-model="s.edit_name"
                  type="text"
                  class="edit-name-input"
                  placeholder="部品名を入力"
                  :disabled="isImageMismatched(s) || processingId === s.id"
                />
              </div>

              <!-- 型番の編集 -->
              <div class="form-row-name">
                <label class="field-label">型番 (編集可):</label>
                <input
                  v-model="s.edit_part_number"
                  type="text"
                  class="edit-name-input"
                  placeholder="型番（空欄なら現在値を保持）"
                  :disabled="isImageMismatched(s) || processingId === s.id"
                />
                <small v-if="s.current_part_number && s.current_part_number !== s.edit_part_number" class="field-note">
                  現在の型番: {{ s.current_part_number }}（採用すると上書き）
                </small>
              </div>

              <!-- メタデータタグ群 -->
              <div class="meta-tags-grid">
                <div v-if="s.manufacturer" class="meta-tag">
                  <span class="tag-k">メーカー:</span> {{ s.manufacturer }}
                </div>
                <div v-if="s.package" class="meta-tag">
                  <span class="tag-k">パッケージ:</span> {{ s.package }}
                </div>
                <div v-if="s.markings" class="meta-tag highlight">
                  <span class="tag-k">刻印:</span> {{ s.markings }}
                </div>
              </div>

              <!-- カテゴリ反映チェック -->
              <div v-if="s.category_hint" class="category-hint-row">
                <label class="category-checkbox-label">
                  <input
                    type="checkbox"
                    v-model="s.apply_category"
                    :disabled="isImageMismatched(s)"
                  />
                  <span>カテゴリ「<strong>{{ s.category_hint }}</strong>」も反映する</span>
                </label>
              </div>

              <!-- 説明文 -->
              <p v-if="s.description" class="part-description">
                {{ s.description }}
              </p>
            </div>

            <!-- アクションボタン -->
            <div class="card-actions-col">
              <button
                class="btn btn-success action-btn"
                :disabled="isImageMismatched(s) || processingId === s.id"
                @click="handleApply(s)"
                title="この名前を採用して部品を更新"
              >
                ✅ 採用
              </button>
              <button
                class="btn btn-secondary action-btn"
                :disabled="processingId === s.id"
                @click="handleResuggest(s)"
                title="同じモデルで再判定を実行"
              >
                🔄 再判定
              </button>
              <button
                class="btn btn-danger action-btn"
                :disabled="processingId === s.id"
                @click="handleReject(s)"
                title="候補を却下"
              >
                ❌ 却下
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-secondary" @click="$emit('close')">閉じる</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.75);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
  padding: 1.5rem;
}

.modal-content {
  width: 100%;
  max-width: 960px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-card-solid);
  color: var(--text-main);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
  border: 1px solid var(--border-color);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.header-title-row h2 {
  margin: 0;
  font-size: 1.35rem;
  color: #f8fafc;
}

.header-subtitle {
  font-size: 0.85rem;
  color: #94a3b8;
  margin-top: 0.25rem;
  display: block;
}

.modal-actions-bar {
  display: flex;
  gap: 1rem;
  padding: 0.75rem 1.5rem;
  background: rgba(0, 0, 0, 0.2);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  align-items: center;
}

.apply-high-btn {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  border: none;
  font-weight: bold;
}

.apply-high-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.modal-body {
  padding: 1.25rem 1.5rem;
  overflow-y: auto;
  flex: 1;
}

.modal-footer {
  padding: 1rem 1.5rem;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  justify-content: flex-end;
}

.state-message {
  text-align: center;
  padding: 3rem 1rem;
  color: #94a3b8;
}

.empty-message p {
  font-size: 1.1rem;
  color: #f1f5f9;
}

.empty-message .subtext {
  font-size: 0.9rem;
  color: #64748b;
  margin-top: 0.5rem;
}

.suggestion-list {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.suggestion-card {
  display: grid;
  grid-template-columns: 140px 1fr 110px;
  gap: 1.25rem;
  padding: 1.25rem;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  align-items: start;
}

.suggestion-card.mismatch {
  border-color: #ef4444;
  background: rgba(239, 68, 68, 0.05);
}

.card-image-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.thumb-img {
  width: 130px;
  height: 130px;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.no-img-box {
  width: 130px;
  height: 130px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #64748b;
  font-size: 0.85rem;
}

.model-badge {
  font-size: 0.72rem;
  background: rgba(255, 255, 255, 0.1);
  padding: 0.2rem 0.5rem;
  border-radius: 9999px;
  color: #cbd5e1;
  max-width: 130px;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}

.card-details-col {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.card-top-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.orig-name {
  font-size: 0.85rem;
  color: #94a3b8;
}

.orig-val {
  color: #e2e8f0;
  margin-left: 0.4rem;
  font-weight: 500;
}

.confidence-badge {
  font-size: 0.75rem;
  font-weight: bold;
  padding: 0.2rem 0.6rem;
  border-radius: 9999px;
}

.badge-high {
  background: rgba(16, 185, 129, 0.2);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.4);
}

.badge-mid {
  background: rgba(245, 158, 11, 0.2);
  color: #fbbf24;
  border: 1px solid rgba(245, 158, 11, 0.4);
}

.badge-low {
  background: rgba(239, 68, 68, 0.2);
  color: #f87171;
  border: 1px solid rgba(239, 68, 68, 0.4);
}

.alert-box-warning {
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid #ef4444;
  color: #fca5a5;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  font-size: 0.82rem;
}

.form-row-name {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.field-label {
  font-size: 0.8rem;
  color: #94a3b8;
  font-weight: 600;
}

.edit-name-input {
  width: 100%;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  padding: 0.6rem 0.8rem;
  color: #fff;
  font-size: 0.95rem;
  font-weight: 600;
}

.edit-name-input:focus {
  outline: none;
  border-color: #38bdf8;
  background: rgba(255, 255, 255, 0.1);
}

.meta-tags-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.meta-tag {
  font-size: 0.78rem;
  background: rgba(255, 255, 255, 0.06);
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  color: #e2e8f0;
}

.meta-tag .tag-k {
  color: #94a3b8;
  margin-right: 0.25rem;
}

.meta-tag.highlight {
  background: rgba(56, 189, 248, 0.15);
  color: #7dd3fc;
  border: 1px solid rgba(56, 189, 248, 0.3);
}

.category-hint-row {
  font-size: 0.85rem;
  color: #cbd5e1;
}

.category-checkbox-label {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  cursor: pointer;
}

.part-description {
  font-size: 0.8rem;
  color: #94a3b8;
  margin: 0;
  line-height: 1.4;
}

.card-actions-col {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: 100%;
}

.action-btn {
  width: 100%;
  padding: 0.5rem 0.2rem;
  font-size: 0.85rem;
  text-align: center;
  justify-content: center;
}

@media (max-width: 768px) {
  .suggestion-card {
    grid-template-columns: 1fr;
    gap: 1rem;
  }
  .card-image-col {
    flex-direction: row;
    justify-content: flex-start;
  }
  .card-actions-col {
    flex-direction: row;
  }
}
</style>
