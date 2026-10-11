<template>
  <div class="used-parts-view">
    <!-- 検索・絞り込みコントロール -->
    <div class="used-controls">
      <div class="search-box">
        <label class="search-label">
          <AppIcon name="search" size="14" class="search-icon" />
          <input
            v-model="searchQuery"
            type="search"
            placeholder="部品名や説明で検索..."
            class="search-input"
          />
        </label>
      </div>
      <div class="search-box">
        <label class="search-label">
          <input
            v-model="usedForFilter"
            type="text"
            placeholder="使用先で絞り込み..."
            class="search-input"
          />
        </label>
      </div>
    </div>

    <!-- ローディング -->
    <div v-if="loading" class="state-message">
      読み込み中...
    </div>

    <!-- エラー -->
    <div v-else-if="error" class="state-message error">
      {{ error }}
    </div>

    <!-- 空状態 -->
    <div v-else-if="usedParts.length === 0" class="empty-state">
      <div class="empty-icon" aria-hidden="true">
        <AppIcon name="check" size="32" />
      </div>
      <p class="empty-text">現在、使用済みの部品はありません</p>
    </div>

    <!-- 一覧表示 -->
    <div v-else class="used-content">
      <!-- デスクトップ：テーブル表示 -->
      <div class="used-table-wrap only-desktop">
        <table class="used-table">
          <thead>
            <tr>
              <th style="width: 48px;">写真</th>
              <th>型番 / 名前</th>
              <th>使用先</th>
              <th>使用日時</th>
              <th>備考</th>
              <th>元の保管場所</th>
              <th>個数</th>
              <th style="width: 140px;">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="part in usedParts" :key="part.id" class="used-row">
              <td class="col-thumb">
                <div class="thumb-box-40">
                  <img
                    v-if="part.image_path"
                    :src="part.image_path"
                    :alt="part.name"
                    loading="lazy"
                    decoding="async"
                    class="thumb-img"
                  />
                  <div v-else class="thumb-placeholder">
                    <AppIcon name="chip" size="20" />
                  </div>
                </div>
              </td>
              <td class="col-name">
                <div class="name-wrap">
                  <span v-if="part.part_number" class="part-pn mono">{{ part.part_number }}</span>
                  <span class="part-nm">{{ part.name }}</span>
                </div>
              </td>
              <td class="col-meta">{{ part.used_for || '-' }}</td>
              <td class="col-meta mono">{{ formatDateTime(part.used_at) }}</td>
              <td class="col-note">{{ part.used_note || '-' }}</td>
              <td class="col-meta">{{ part.location_name || '-' }}</td>
              <td class="col-qty mono">{{ part.quantity }}</td>
              <td class="col-actions">
                <button type="button" class="btn btn-secondary btn-sm" @click="$emit('edit', part)">
                  編集
                </button>
                <button type="button" class="btn btn-primary btn-sm" @click="restorePart(part)">
                  通常へ戻す
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- モバイル：スタック表示 -->
      <div class="used-stack only-mobile">
        <article v-for="part in usedParts" :key="part.id" class="used-stack-item">
          <div class="thumb-box-52">
            <img
              v-if="part.image_path"
              :src="part.image_path"
              :alt="part.name"
              loading="lazy"
              decoding="async"
              class="thumb-img"
            />
            <div v-else class="thumb-placeholder">
              <AppIcon name="chip" size="28" />
            </div>
          </div>
          <div class="stack-info">
            <span v-if="part.part_number" class="part-pn mono">{{ part.part_number }}</span>
            <h2 class="part-nm-title">{{ part.name }}</h2>
            <div class="stack-meta">
              <span>使用先: {{ part.used_for || '-' }}</span>
              <span>·</span>
              <span class="mono">{{ formatDateTime(part.used_at) }}</span>
            </div>
            <div class="stack-actions">
              <button type="button" class="btn btn-secondary btn-sm" @click="$emit('edit', part)">
                編集
              </button>
              <button type="button" class="btn btn-primary btn-sm" @click="restorePart(part)">
                通常へ戻す
              </button>
            </div>
          </div>
        </article>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue';
import api from '../api';
import { useToast } from '../composables/useToast';
import AppIcon from './ui/AppIcon.vue';

const toast = useToast();
defineEmits(['edit']);

const usedParts = ref([]);
const loading = ref(true);
const error = ref(null);
const searchQuery = ref('');
const usedForFilter = ref('');

const fetchParts = async () => {
  loading.value = true;
  error.value = null;
  try {
    const params = {
      status: 'used',
      sort: 'used_for',
      order: 'asc'
    };

    if (searchQuery.value) params.search = searchQuery.value;
    if (usedForFilter.value) params.used_for = usedForFilter.value;

    const res = await api.get('/parts', { params });
    usedParts.value = res.data;
  } catch (err) {
    console.error(err);
    error.value = '使用済み部品の取得に失敗しました';
  } finally {
    loading.value = false;
  }
};

let timeout;
watch([searchQuery, usedForFilter], () => {
  clearTimeout(timeout);
  timeout = setTimeout(fetchParts, 250);
});

onMounted(fetchParts);

const formatDateTime = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ja-JP');
};

const restorePart = async (part) => {
  if (!confirm(`部品「${part.name}」を通常在庫へ戻しますか？`)) return;

  try {
    await api.post(`/parts/${part.id}/unuse`);
    await fetchParts();
    toast.success(`部品「${part.name}」を通常在庫へ復帰しました`);
  } catch (err) {
    console.error(err);
    const message = err.response?.data?.error || '通常在庫への復帰に失敗しました';
    toast.error(message);
  }
};

defineExpose({ fetchParts });
</script>

<style scoped>
.used-parts-view {
  display: flex;
  flex-direction: column;
  padding: 16px 20px 32px;
  gap: var(--space-4);
}

.used-controls {
  display: flex;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.search-box {
  flex: 1;
  min-width: 200px;
}

.search-label {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: 32px;
  padding: 0 var(--space-2);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.search-label:focus-within {
  border-color: var(--accent);
}

.search-icon {
  color: var(--text-3);
}

.search-input {
  flex: 1;
  height: 100%;
  border: none;
  background: transparent;
  color: var(--text);
  font-family: var(--font-sans);
  font-size: var(--fs-13);
  outline: none;
}

.search-input::placeholder {
  color: var(--text-3);
}

.state-message {
  padding: 40px 20px;
  text-align: center;
  color: var(--text-3);
  font-size: var(--fs-13);
}

.state-message.error {
  color: var(--ng-fg);
}

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

/* デスクトップテーブル */
.used-table-wrap {
  overflow-x: auto;
}

.used-table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
}

.used-table th {
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-strong);
  font-size: var(--fs-12);
  font-weight: 500;
  color: var(--text-3);
}

.used-row td {
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
  background: var(--surface);
  font-size: var(--fs-13);
}

.thumb-box-40 {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.thumb-box-52 {
  width: 52px;
  height: 52px;
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.thumb-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.thumb-placeholder {
  color: var(--text-3);
}

.name-wrap {
  display: flex;
  flex-direction: column;
}

.part-pn {
  font-size: var(--fs-13);
  font-weight: 500;
  color: var(--text);
}

.part-nm {
  font-size: var(--fs-12);
  color: var(--text-2);
}

.col-meta {
  color: var(--text-2);
  font-size: var(--fs-12);
}

.col-note {
  color: var(--text-3);
  font-size: var(--fs-12);
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.col-qty {
  font-weight: 500;
  color: var(--text);
}

.col-actions {
  display: flex;
  gap: var(--space-2);
}

/* モバイルスタック */
.used-stack {
  display: flex;
  flex-direction: column;
}

.used-stack-item {
  display: flex;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-2);
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

.stack-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.part-nm-title {
  font-size: var(--fs-13);
  font-weight: 500;
  color: var(--text);
  margin: 0;
}

.stack-meta {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--fs-11);
  color: var(--text-3);
}

.stack-actions {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-1);
}
</style>
