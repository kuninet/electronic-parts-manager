<script setup>
import { ref, onMounted, computed, watch } from 'vue';
import api from '../api';
import { useToast } from '../composables/useToast';
import { useHoverImagePreview } from '../composables/useHoverImagePreview.js';
import ImageZoomDialog from './ImageZoomDialog.vue';

const toast = useToast();
const hoverZoom = useHoverImagePreview();
const zoomTarget = ref(null);
const bodyRef = ref(null);

const openZoom = (s) => {
  hoverZoom.hide();
  zoomTarget.value = {
    src: resolveImageUrl(s.image_path),
    alt: `${s.current_part_name} の写真`,
    caption: `判定時の写真 · ${s.current_part_name}`
  };
};

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

watch(
  () => suggestions.value.length,
  () => {
    hoverZoom.hide();
  }
);

// 個別採用
const handleApply = async (s) => {
  hoverZoom.hide();
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
  hoverZoom.hide();
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
  hoverZoom.hide();
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
  hoverZoom.hide();
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

      <div
        ref="bodyRef"
        class="modal-body"
        @scroll="hoverZoom.hide()"
        @wheel.passive="hoverZoom.hide()"
      >
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
              <button
                v-if="s.image_path"
                type="button"
                class="thumb-btn"
                :aria-label="`${s.current_part_name} の写真を拡大`"
                @mouseenter="hoverZoom.schedule($event, { src: resolveImageUrl(s.image_path), caption: `判定時の写真 · ${s.current_part_name}` })"
                @mouseleave="hoverZoom.hide()"
                @mousedown="hoverZoom.hide()"
                @click="openZoom(s)"
              >
                <img
                  :src="resolveImageUrl(s.image_path)"
                  alt="部品写真"
                  class="thumb-img"
                />
              </button>
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

    <!-- ホバー拡大ポップアップ -->
    <Teleport to="body">
      <div
        v-if="hoverZoom.preview.visible"
        class="hover-zoom"
        :class="`side-${hoverZoom.preview.side}`"
        :style="{
          left: `${hoverZoom.preview.left}px`,
          top: `${hoverZoom.preview.top}px`,
          width: `${hoverZoom.preview.width}px`,
          height: `${hoverZoom.preview.height}px`
        }"
        aria-hidden="true"
      >
        <img :src="hoverZoom.preview.src" alt="" class="hover-zoom-img" />
        <span v-if="hoverZoom.preview.caption" class="hover-zoom-caption">{{ hoverZoom.preview.caption }}</span>
      </div>
    </Teleport>

    <!-- 写真拡大ダイアログ -->
    <ImageZoomDialog
      v-if="zoomTarget"
      :src="zoomTarget.src"
      :alt="zoomTarget.alt"
      :caption="zoomTarget.caption"
      @close="zoomTarget = null"
    />
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: var(--overlay);
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
  background: var(--surface);
  color: var(--text);
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: var(--shadow-lg);
  border: 1px solid var(--border);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--border);
}

.header-title-row h2 {
  margin: 0;
  font-size: 1.35rem;
  color: var(--text);
}

.header-subtitle {
  font-size: 0.85rem;
  color: var(--text-2);
  margin-top: 0.25rem;
  display: block;
}

.modal-actions-bar {
  display: flex;
  gap: 1rem;
  padding: 0.75rem 1.5rem;
  background: var(--surface-2);
  border-bottom: 1px solid var(--border);
  align-items: center;
}

.apply-high-btn {
  background: var(--ok-fg);
  color: var(--bg);
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
  border-top: 1px solid var(--border);
  display: flex;
  justify-content: flex-end;
}

.state-message {
  text-align: center;
  padding: 3rem 1rem;
  color: var(--text-2);
}

.empty-message p {
  font-size: 1.1rem;
  color: var(--text);
}

.empty-message .subtext {
  font-size: 0.9rem;
  color: var(--text-3);
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
  border-radius: var(--radius-md);
  background: var(--surface-2);
  border: 1px solid var(--border);
  align-items: start;
}

.suggestion-card.mismatch {
  border-color: var(--ng);
  background: var(--ng-bg);
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
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
}

.no-img-box {
  width: 130px;
  height: 130px;
  background: var(--surface-2);
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-3);
  font-size: 0.85rem;
}

.model-badge {
  font-size: 0.72rem;
  background: var(--surface-2);
  padding: 0.2rem 0.5rem;
  border-radius: 9999px;
  color: var(--text-2);
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
  color: var(--text-2);
}

.orig-val {
  color: var(--text);
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
  background: var(--ok-bg);
  color: var(--ok-fg);
  border: 1px solid var(--ok);
}

.badge-mid {
  background: var(--warn-bg);
  color: var(--warn-fg);
  border: 1px solid var(--warn);
}

.badge-low {
  background: var(--ng-bg);
  color: var(--ng-fg);
  border: 1px solid var(--ng);
}

.alert-box-warning {
  background: var(--ng-bg);
  border: 1px solid var(--ng);
  color: var(--ng-fg);
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius-sm);
  font-size: 0.82rem;
}

.form-row-name {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.field-label {
  font-size: 0.8rem;
  color: var(--text-2);
  font-weight: 600;
}

.edit-name-input {
  width: 100%;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 0.6rem 0.8rem;
  color: var(--text);
  font-size: 0.95rem;
  font-weight: 600;
}

.edit-name-input:focus {
  outline: none;
  border-color: var(--accent);
  background: var(--surface-2);
}

.meta-tags-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.meta-tag {
  font-size: 0.78rem;
  background: var(--surface-2);
  padding: 0.2rem 0.5rem;
  border-radius: var(--radius-sm);
  color: var(--text);
}

.meta-tag .tag-k {
  color: var(--text-2);
  margin-right: 0.25rem;
}

.meta-tag.highlight {
  background: var(--accent-soft);
  color: var(--accent);
  border: 1px solid var(--accent);
}

.category-hint-row {
  font-size: 0.85rem;
  color: var(--text-2);
}

.category-checkbox-label {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  cursor: pointer;
}

.part-description {
  font-size: 0.8rem;
  color: var(--text-2);
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

.thumb-btn {
  border: none;
  background: none;
  padding: 0;
  cursor: zoom-in;
  display: block;
  line-height: 0;
  border-radius: var(--radius-sm);
  transition: opacity var(--dur-fast) var(--ease);
}

.thumb-btn:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

.hover-zoom {
  position: fixed;
  z-index: 2500;
  pointer-events: none;
  padding: var(--space-2);
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  box-sizing: border-box;
}

.hover-zoom-img {
  flex: 1;
  min-height: 0;
  width: 100%;
  object-fit: contain;
  background: var(--surface-2);
  border-radius: var(--radius-md);
}

.hover-zoom-caption {
  font-size: var(--fs-12);
  color: var(--text-2);
}
</style>
