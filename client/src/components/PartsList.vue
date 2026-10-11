<template>
  <div class="parts-list-view">
    <!-- フィルタ・コントロールバー -->
    <FilterBar
      :categories="categories"
      :locations="locations"
      :tags="tags"
      :count="displayedParts.length"
      :show-trash="showTrash"
      :ai-available="aiStatus.enabled"
      @update:show-trash="showTrash = $event"
      @open-ai-batch="openAiBatchModal"
    />

    <!-- ローディング（スケルトン表示） -->
    <div v-if="loading" class="parts-content" aria-busy="true">
      <!-- モバイル（スタック） -->
      <div v-if="isMobileView" class="parts-stack">
        <PartCardSkeleton type="stack" :count="8" />
      </div>

      <!-- デスクトップ：グリッド -->
      <div v-else-if="filters.viewMode.value === 'grid'" class="parts-grid" :class="filters.gridSize.value">
        <PartCardSkeleton type="card" :count="12" />
      </div>

      <!-- デスクトップ：テーブル -->
      <div v-else class="parts-table-wrap">
        <table class="parts-table">
          <thead>
            <tr>
              <th style="width: 32px;"></th>
              <th style="width: 48px;"></th>
              <th>型番 / 名前</th>
              <th>カテゴリ</th>
              <th>保管場所</th>
              <th>在庫</th>
              <th style="width: 60px;"></th>
            </tr>
          </thead>
          <tbody>
            <PartCardSkeleton type="row" :count="8" />
          </tbody>
        </table>
      </div>
    </div>

    <!-- コンテンツ表示（データ取得完了後） -->
    <div v-else class="parts-content">
      <!-- 空状態 -->
      <div v-if="displayedParts.length === 0" class="empty-state">
        <div class="empty-icon" aria-hidden="true">
          <AppIcon name="search" size="32" />
        </div>
        <p class="empty-text">条件に一致するパーツはありません</p>
        <button type="button" class="btn btn-secondary btn-sm" @click="filters.clearAll">
          絞り込みを解除
        </button>
      </div>

      <!-- モバイル表示（スタック行リスト） -->
      <div v-else-if="isMobileView" class="parts-stack">
        <PartRow
          v-for="part in displayedParts"
          :key="part.id"
          :part="part"
          :selected="selectedParts.includes(part.id)"
          :visible="visibleParts.has(part.id)"
          mode="stack"
          @edit="$emit('edit', part)"
          @preview="$emit('preview', part)"
          @toggle-select="toggleSelect(part.id)"
        />
      </div>

      <!-- デスクトップ：グリッド表示 -->
      <div
        v-else-if="filters.viewMode.value === 'grid'"
        class="parts-grid"
        :class="filters.gridSize.value"
      >
        <PartCard
          v-for="part in displayedParts"
          :key="part.id"
          :part="part"
          :selected="selectedParts.includes(part.id)"
          :visible="visibleParts.has(part.id)"
          :selection-mode="selectedParts.length > 0"
          @edit="$emit('edit', part)"
          @preview="$emit('preview', part)"
          @toggle-select="toggleSelect(part.id)"
          @quick-update="quickUpdatePart(part.id, $event)"
        />
      </div>

      <!-- デスクトップ：リスト（テーブル）表示 -->
      <div v-else class="parts-table-wrap">
        <table class="parts-table">
          <thead>
            <tr>
              <th class="col-th-check">
                <input
                  type="checkbox"
                  :checked="isAllSelected"
                  :indeterminate.prop="isPartialSelected"
                  aria-label="すべて選択"
                  class="select-checkbox"
                  @change="toggleSelectAll"
                />
              </th>
              <th style="width: 48px;">写真</th>
              <th>型番 / 名前</th>
              <th>カテゴリ</th>
              <th>保管場所</th>
              <th>在庫</th>
              <th style="width: 60px;">操作</th>
            </tr>
          </thead>
          <tbody>
            <PartRow
              v-for="part in displayedParts"
              :key="part.id"
              :part="part"
              :selected="selectedParts.includes(part.id)"
              :visible="visibleParts.has(part.id)"
              mode="table"
              @edit="$emit('edit', part)"
              @preview="$emit('preview', part)"
              @toggle-select="toggleSelect(part.id)"
            />
          </tbody>
        </table>
      </div>
    </div>

    <!-- 一括操作バー -->
    <div v-if="selectedParts.length > 0" class="bulk-action-bar">
      <span class="bulk-count">{{ selectedParts.length }} 件選択中</span>
      <div class="bulk-buttons">
        <template v-if="!showTrash">
          <button type="button" class="btn btn-secondary btn-sm" :disabled="bulkBusy" @click="showBulkEditModal = true">
            一括編集
          </button>
          <button type="button" class="btn btn-danger btn-sm" :disabled="bulkBusy" @click="handleBulkAction(BULK_ACTION.TRASH)">
            ゴミ箱へ
          </button>
        </template>
        <template v-else>
          <button type="button" class="btn btn-secondary btn-sm" :disabled="bulkBusy" @click="handleBulkAction(BULK_ACTION.RESTORE)">
            復元
          </button>
          <button type="button" class="btn btn-danger btn-sm" :disabled="bulkBusy" @click="handleBulkAction(BULK_ACTION.PERMANENT_DELETE)">
            完全削除
          </button>
        </template>
      </div>
    </div>

    <!-- 一括編集モーダル -->
    <BulkEditModal
      v-if="showBulkEditModal"
      :selected-count="selectedParts.length"
      @close="showBulkEditModal = false"
      @save="handleBulkUpdate"
    />

    <!-- AI 一括判定モーダル -->
    <div
      v-if="showAiBatchModal"
      class="modal-overlay"
      @click.self="aiBatchProgress.running ? null : (showAiBatchModal = false)"
    >
      <div class="modal-content ai-batch-modal-box">
        <div class="modal-header">
          <h2>AI 部品名一括判定</h2>
          <button
            v-if="!aiBatchProgress.running"
            type="button"
            class="btn-icon modal-close-btn"
            @click="showAiBatchModal = false"
          >
            <AppIcon name="x" size="14" />
          </button>
        </div>

        <div class="modal-body">
          <div v-if="!aiBatchProgress.running && !aiBatchProgress.completed">
            <p class="batch-intro">
              写真が登録されている部品から、Gemini AIを使って部品名・型番・メーカー等を自動判定します。
            </p>

            <div class="target-summary-box">
              <span class="summary-label">判定対象:</span>
              <strong v-if="selectedParts.length > 0">
                選択中の部品のうち写真あり {{ getBatchTargets().length }} 件
              </strong>
              <strong v-else>
                仮名の部品のうち写真あり {{ getBatchTargets().length }} 件
              </strong>
            </div>

            <div v-if="getBatchTargets().length === 0" class="alert-box-warning">
              対象となる部品がありません（写真が登録されている部品が必要です）。
            </div>

            <div class="form-group">
              <label>使用するGeminiモデル:</label>
              <select
                v-model="selectedAiModel"
                class="form-select"
                :disabled="aiModels.length === 0"
              >
                <option v-if="aiModels.length === 0" value="" disabled>モデルを読み込み中...</option>
                <option v-for="m in aiModels" :key="m.id" :value="m.id">
                  {{ m.name }} ({{ m.description }})
                </option>
              </select>
            </div>

            <div class="api-status-info">
              本日実行数: {{ aiStatus.todayCount }} / {{ aiStatus.dailyLimit }} 件
            </div>
          </div>

          <!-- 実行中プログレス -->
          <div v-else-if="aiBatchProgress.running" class="batch-running-box">
            <div class="progress-header">
              <span>判定中... {{ aiBatchProgress.current }} / {{ aiBatchProgress.total }} 件</span>
              <span class="progress-pct">
                {{ Math.round((aiBatchProgress.current / aiBatchProgress.total) * 100) }}%
              </span>
            </div>
            <div class="progress-bar-bg">
              <div
                class="progress-bar-fill"
                :style="{
                  width: Math.round((aiBatchProgress.current / aiBatchProgress.total) * 100) + '%'
                }"
              ></div>
            </div>
            <p class="current-item-name">処理中: {{ aiBatchProgress.currentName }}</p>
            <div class="run-stats">
              <span class="stat-success">成功: {{ aiBatchProgress.successCount }}</span>
              <span class="stat-error">失敗: {{ aiBatchProgress.errorCount }}</span>
            </div>
          </div>

          <!-- 完了画面 -->
          <div v-else-if="aiBatchProgress.completed" class="batch-completed-box">
            <h3>判定完了</h3>
            <p>
              {{ aiBatchProgress.successCount }} 件の判定候補を生成しました。
              <span v-if="aiBatchProgress.errorCount > 0">（失敗: {{ aiBatchProgress.errorCount }} 件）</span>
            </p>
            <button
              type="button"
              class="btn btn-primary btn-block"
              @click="openAiReviewFromBatch"
            >
              判定候補を確認する
            </button>
          </div>
        </div>

        <div v-if="!aiBatchProgress.running && !aiBatchProgress.completed" class="modal-footer">
          <button type="button" class="btn btn-secondary" @click="showAiBatchModal = false">
            キャンセル
          </button>
          <button
            type="button"
            class="btn btn-primary"
            :disabled="getBatchTargets().length === 0"
            @click="startAiBatch"
          >
            判定開始
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import api from '../api';
import { isAutoNamed, BULK_ACTION } from '../constants';
import { usePartsFilters } from '../composables/usePartsFilters';
import { usePartsStats } from '../composables/usePartsStats';
import { useQuantitySync } from '../composables/useQuantitySync';
import { useToast } from '../composables/useToast';
import AppIcon from './ui/AppIcon.vue';
import FilterBar from './parts/FilterBar.vue';
import PartCard from './parts/PartCard.vue';
import PartRow from './parts/PartRow.vue';
import PartCardSkeleton from './parts/PartCardSkeleton.vue';
import BulkEditModal from './BulkEditModal.vue';

const emit = defineEmits(['add', 'edit', 'preview', 'open-ai-review']);

const toast = useToast();
const filters = usePartsFilters();
const stats = usePartsStats();
const qtySync = useQuantitySync();

const parts = ref([]);
const categories = ref([]);
const locations = ref([]);
const tags = ref([]);
const loading = ref(true);
const showTrash = ref(false);

const selectedParts = ref([]);
const bulkBusy = ref(false);
const showBulkEditModal = ref(false);

// モバイル画面判定
const isMobileView = ref(false);
let mediaQueryList = null;

const checkMobile = () => {
  if (typeof window !== 'undefined') {
    isMobileView.value = window.matchMedia('(max-width: 768px)').matches;
  }
};

// 遅延読み込み (IntersectionObserver)
const visibleParts = ref(new Set());
let observer = null;

const initObserver = () => {
  if (observer) observer.disconnect();
  if (typeof window === 'undefined' || !window.IntersectionObserver) return;

  observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const id = Number(entry.target.dataset.partId);
          if (id) visibleParts.value.add(id);
        }
      });
    },
    { rootMargin: '200px 0px' }
  );

  nextTick(() => {
    document.querySelectorAll('[data-part-id]').forEach((el) => {
      observer.observe(el);
    });
  });
};

// AI 関連
const aiStatus = ref({ enabled: false, todayCount: 0, dailyLimit: 50 });
const aiModels = ref([]);
const selectedAiModel = ref('');
const showAiBatchModal = ref(false);
const aiBatchProgress = ref({
  running: false,
  completed: false,
  current: 0,
  total: 0,
  currentName: '',
  successCount: 0,
  errorCount: 0
});

const fetchAiStatus = async () => {
  try {
    const res = await api.get('/ai-naming/status');
    aiStatus.value = res.data;
  } catch {}
};

const fetchAiModels = async () => {
  try {
    const res = await api.get('/ai-naming/models');
    aiModels.value = res.data;
    if (res.data.length > 0 && !selectedAiModel.value) {
      selectedAiModel.value = res.data[0].id;
    }
  } catch {}
};

// パーツ一覧取得
const fetchParts = async () => {
  loading.value = true;
  try {
    const params = {
      search: filters.debouncedQuery.value || undefined,
      category_id:
        filters.categoryId.value && filters.categoryId.value !== 'none'
          ? filters.categoryId.value
          : undefined,
      location_id: filters.locationId.value || undefined,
      tag_id: filters.tagId.value || undefined,
      sort: filters.sort.value,
      order: filters.order.value,
      status: showTrash.value ? 'trash' : 'active'
    };

    const res = await api.get('/parts', { params });
    parts.value = qtySync.overlay(res.data);
    initObserver();
  } catch (err) {
    console.error(err);
    toast.error('パーツ一覧の取得に失敗しました');
  } finally {
    loading.value = false;
  }
};

const fetchMasters = async () => {
  try {
    const [cRes, lRes, tRes] = await Promise.all([
      api.get('/categories'),
      api.get('/locations'),
      api.get('/tags')
    ]);
    categories.value = cRes.data;
    locations.value = lRes.data;
    tags.value = tRes.data;
  } catch (err) {
    console.error(err);
  }
};

// クライアント側での未分類絞り込み（'none' 時）
const displayedParts = computed(() => {
  if (filters.categoryId.value === 'none') {
    return parts.value.filter((p) => !p.category_id);
  }
  return parts.value;
});

// 選択状態
const isAllSelected = computed(() => {
  return (
    displayedParts.value.length > 0 &&
    selectedParts.value.length === displayedParts.value.length
  );
});

const isPartialSelected = computed(() => {
  return (
    selectedParts.value.length > 0 &&
    selectedParts.value.length < displayedParts.value.length
  );
});

const toggleSelect = (id) => {
  const idx = selectedParts.value.indexOf(id);
  if (idx >= 0) {
    selectedParts.value.splice(idx, 1);
  } else {
    selectedParts.value.push(id);
  }
};

const toggleSelectAll = () => {
  if (isAllSelected.value) {
    selectedParts.value = [];
  } else {
    selectedParts.value = displayedParts.value.map((p) => p.id);
  }
};

// 単一部品のインライン更新差し替え
const replacePart = (updated) => {
  const idx = parts.value.findIndex((p) => p.id === updated.id);
  if (idx !== -1) {
    parts.value[idx] = {
      ...parts.value[idx],
      ...updated,
      quantity: qtySync.displayOf(updated)
    };
  }
  stats.refresh();
};

const quickUpdatePart = async (id, changes) => {
  try {
    const res = await api.patch(`/parts/${id}`, changes);
    replacePart(res.data);
  } catch (err) {
    console.error(err);
    toast.error(err.response?.data?.error || '更新に失敗しました');
  }
};

// 一括操作
const handleBulkAction = async (action) => {
  if (bulkBusy.value || selectedParts.value.length === 0) return;
  const ids = [...selectedParts.value];
  if (action === BULK_ACTION.TRASH) {
    const qrCount = parts.value.filter((p) => ids.includes(p.id) && p.qr_code).length;
    let msg = `選択した ${ids.length} 件をゴミ箱へ移動しますか？`;
    if (qrCount > 0) msg += `\n\n※ ${qrCount} 件の QR コードの紐付けが解除され、復元しても戻りません`;
    if (!confirm(msg)) return;
  }
  if (action === BULK_ACTION.PERMANENT_DELETE &&
      !confirm(`選択した ${ids.length} 件を完全に削除します。\n画像も削除され、この操作は取り消せません。よろしいですか？`)) return;

  bulkBusy.value = true;
  try {
    if (action !== BULK_ACTION.RESTORE) ids.forEach((id) => qtySync.discard(id));
    const res = await api.post('/parts/bulk/action', { action, ids });
    const affected = Number(res.data?.affected ?? ids.length);
    const label = { trash: 'ゴミ箱へ移動しました', restore: '復元しました', delete: '完全に削除しました' }[action];
    toast.success(`${affected} 件を${label}`);
    if (affected < ids.length) toast.info(`${ids.length - affected} 件は対象外のため処理されませんでした`);
    selectedParts.value = [];
    await fetchParts();
    stats.refresh();
  } catch (err) {
    console.error(err);
    toast.error(err.response?.data?.error || '一括操作に失敗しました');
  } finally {
    bulkBusy.value = false;
  }
};

const handleBulkUpdate = async (updateData) => {
  if (bulkBusy.value || selectedParts.value.length === 0) return;
  bulkBusy.value = true;
  try {
    await api.post('/parts/bulk/update', {
      ids: [...selectedParts.value],
      updates: updateData
    });
    showBulkEditModal.value = false;
    selectedParts.value = [];
    toast.success('一括変更を適用しました');
    await fetchParts();
    stats.refresh();
  } catch (err) {
    console.error(err);
    toast.error(err.response?.data?.error || '一括更新に失敗しました');
  } finally {
    bulkBusy.value = false;
  }
};

// AI 一括判定
const getBatchTargets = () => {
  const source =
    selectedParts.value.length > 0
      ? parts.value.filter((p) => selectedParts.value.includes(p.id))
      : parts.value.filter((p) => isAutoNamed(p.name));
  return source.filter((p) => !!p.image_path);
};

const openAiBatchModal = () => {
  fetchAiStatus();
  fetchAiModels();
  aiBatchProgress.value = {
    running: false,
    completed: false,
    current: 0,
    total: 0,
    currentName: '',
    successCount: 0,
    errorCount: 0
  };
  showAiBatchModal.value = true;
};

const startAiBatch = async () => {
  const targets = getBatchTargets();
  if (targets.length === 0) return;

  aiBatchProgress.value = {
    running: true,
    completed: false,
    current: 0,
    total: targets.length,
    currentName: '',
    successCount: 0,
    errorCount: 0
  };

  for (const part of targets) {
    aiBatchProgress.value.currentName = part.part_number || part.name;
    try {
      await api.post(`/ai-naming/suggest/${part.id}`, {
        model: selectedAiModel.value || undefined
      });
      aiBatchProgress.value.successCount++;
    } catch {
      aiBatchProgress.value.errorCount++;
    }
    aiBatchProgress.value.current++;
  }

  aiBatchProgress.value.running = false;
  aiBatchProgress.value.completed = true;
  stats.refresh();
};

const openAiReviewFromBatch = () => {
  showAiBatchModal.value = false;
  emit('open-ai-review');
};

// 監視設定
watch(
  [
    filters.debouncedQuery,
    filters.categoryId,
    filters.locationId,
    filters.tagId,
    showTrash,
    filters.sort,
    filters.order
  ],
  () => {
    selectedParts.value = [];
    fetchParts();
  }
);

watch(displayedParts, () => {
  nextTick(() => initObserver());
});

let unregisterQtyListener = null;

onMounted(() => {
  checkMobile();
  if (typeof window !== 'undefined') {
    mediaQueryList = window.matchMedia('(max-width: 768px)');
    mediaQueryList.addEventListener?.('change', checkMobile);
  }

  unregisterQtyListener = qtySync.onConfirmed(replacePart);
  fetchMasters();
  fetchParts();
  fetchAiStatus();
});

onBeforeUnmount(() => {
  qtySync.flushAll();
  if (unregisterQtyListener) unregisterQtyListener();
  if (observer) observer.disconnect();
  if (mediaQueryList) {
    mediaQueryList.removeEventListener?.('change', checkMobile);
  }
});

defineExpose({
  fetchParts
});
</script>

<style scoped>
.parts-list-view {
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - var(--topbar-h));
  position: relative;
}

.parts-content {
  flex: 1;
}

/* 空状態 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  gap: var(--space-3);
  text-align: center;
}

.empty-icon {
  color: var(--text-3);
}

.empty-text {
  font-size: var(--fs-14);
  color: var(--text-2);
}

/* グリッドレイアウト */
.parts-grid {
  display: grid;
  gap: 12px;
  padding: 16px 20px 32px;
}

.parts-grid.small {
  grid-template-columns: repeat(auto-fill, minmax(184px, 1fr));
}

.parts-grid.medium {
  grid-template-columns: repeat(auto-fill, minmax(236px, 1fr));
}

.parts-grid.large {
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
}

/* テーブルレイアウト */
.parts-table-wrap {
  overflow-x: auto;
  padding: 0 20px 32px;
}

.parts-table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
}

.parts-table th {
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-strong);
  font-size: var(--fs-12);
  font-weight: 500;
  color: var(--text-3);
}

.col-th-check {
  width: 32px;
  text-align: center;
}

.select-checkbox {
  cursor: pointer;
  accent-color: var(--accent);
}

/* モバイルスタック */
.parts-stack {
  display: flex;
  flex-direction: column;
}

/* 一括操作バー */
.bulk-action-bar {
  position: sticky;
  bottom: 16px;
  margin: 0 auto;
  width: max-content;
  max-width: calc(100% - 32px);
  z-index: 40;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  padding: var(--space-2) var(--space-4);
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

@media (max-width: 768px) {
  .bulk-action-bar {
    bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom) + 8px);
  }
}

.bulk-count {
  font-size: var(--fs-13);
  font-weight: 500;
  color: var(--text);
  white-space: nowrap;
}

.bulk-buttons {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

/* AI モーダル */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: var(--space-4);
}

.modal-content {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  width: 100%;
  max-width: 520px;
  max-height: 90vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.modal-header {
  padding: var(--space-4);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.modal-header h2 {
  font-size: var(--fs-16);
  font-weight: 600;
  color: var(--text);
  margin: 0;
}

.modal-close-btn {
  background: transparent;
  border: none;
  color: var(--text-3);
  cursor: pointer;
}

.modal-body {
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.batch-intro {
  font-size: var(--fs-13);
  color: var(--text-2);
  line-height: 1.5;
}

.target-summary-box {
  padding: var(--space-3);
  background: var(--surface-2);
  border-radius: var(--radius-md);
  font-size: var(--fs-13);
  color: var(--text);
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.alert-box-warning {
  padding: var(--space-3);
  background: var(--warn-bg);
  color: var(--warn-fg);
  border-radius: var(--radius-md);
  font-size: var(--fs-12);
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.form-group label {
  font-size: var(--fs-12);
  font-weight: 500;
  color: var(--text);
}

.form-select {
  height: 32px;
  padding: 0 var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  color: var(--text);
  font-size: var(--fs-13);
}

.api-status-info {
  font-size: var(--fs-11);
  color: var(--text-3);
}

.batch-running-box {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.progress-header {
  display: flex;
  justify-content: space-between;
  font-size: var(--fs-13);
  color: var(--text);
}

.progress-bar-bg {
  height: 8px;
  background: var(--surface-2);
  border-radius: 4px;
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.2s ease;
}

.current-item-name {
  font-size: var(--fs-12);
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.run-stats {
  display: flex;
  gap: var(--space-4);
  font-size: var(--fs-12);
}

.stat-success {
  color: var(--ok-fg);
}

.stat-error {
  color: var(--ng-fg);
}

.batch-completed-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: var(--space-3);
  padding: var(--space-4) 0;
}

.modal-footer {
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>
