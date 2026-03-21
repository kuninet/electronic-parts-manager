<script setup>
import { ref, onMounted, watch } from 'vue';
import api from '../api';

const emit = defineEmits(['edit']);

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
  } catch (err) {
    console.error(err);
    const message = err.response?.data?.error || '通常在庫への復帰に失敗しました';
    alert(message);
  }
};

defineExpose({ fetchParts });
</script>

<template>
  <div class="used-parts-container">
    <div class="controls glass-panel">
      <input
        v-model="searchQuery"
        type="text"
        placeholder="部品名や説明で検索..."
        class="search-input"
      />
      <input
        v-model="usedForFilter"
        type="text"
        placeholder="使用先で絞り込み..."
        class="filter-input"
      />
    </div>

    <div v-if="loading" class="loading">読み込み中...</div>
    <div v-else-if="error" class="error">{{ error }}</div>
    <div v-else-if="usedParts.length === 0" class="empty-state glass-panel">
      現在、使用済みの部品はありません
    </div>
    <div v-else class="used-parts-grid">
      <div v-for="part in usedParts" :key="part.id" class="used-part-card glass-panel">
        <div class="used-part-image">
          <img v-if="part.image_path" :src="part.image_path" :alt="part.name" />
          <div v-else class="placeholder-image">⚡️</div>
        </div>

        <div class="used-part-content">
          <div class="used-part-header">
            <h3>{{ part.name }}</h3>
            <span class="used-badge">使用済み</span>
          </div>

          <p v-if="part.qr_code" class="qr-code-badge">📱 {{ part.qr_code }}</p>
          <p class="used-meta"><strong>使用先:</strong> {{ part.used_for || '-' }}</p>
          <p class="used-meta"><strong>使用日時:</strong> {{ formatDateTime(part.used_at) }}</p>
          <p v-if="part.used_note" class="used-note">{{ part.used_note }}</p>
          <p class="used-submeta">カテゴリ: {{ part.category_name || '-' }}</p>
          <p class="used-submeta">元の保管場所: {{ part.location_name || '-' }}</p>
          <p class="used-submeta">個数: {{ part.quantity }}</p>

          <div class="card-actions">
            <button class="btn btn-outline" @click="$emit('edit', part)">編集</button>
            <button class="btn btn-primary" @click="restorePart(part)">通常へ戻す</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.used-parts-container {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.controls {
  display: flex;
  gap: 1rem;
  padding: 1rem;
  flex-wrap: wrap;
}

.search-input,
.filter-input {
  flex: 1;
  min-width: 220px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border-color);
  padding: 0.75rem 1rem;
  border-radius: 8px;
  color: white;
  font-size: 1rem;
}

.search-input:focus,
.filter-input:focus {
  outline: none;
  border-color: var(--accent-color);
}

.used-parts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 1.5rem;
}

.used-part-card {
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.used-part-image {
  height: 220px;
  background: rgba(0, 0, 0, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
}

.used-part-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.placeholder-image {
  font-size: 3rem;
  opacity: 0.5;
}

.used-part-content {
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.used-part-header {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: flex-start;
}

.used-part-header h3 {
  margin: 0;
  font-size: 1.1rem;
}

.used-badge {
  background: rgba(245, 158, 11, 0.15);
  color: #fcd34d;
  border: 1px solid rgba(245, 158, 11, 0.25);
  border-radius: 999px;
  padding: 0.2rem 0.7rem;
  font-size: 0.8rem;
  white-space: nowrap;
}

.used-meta,
.used-submeta,
.used-note {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.95rem;
}

.used-note {
  background: rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  padding: 0.75rem;
  color: var(--text-primary);
}

.card-actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 0.5rem;
}

.empty-state,
.loading,
.error {
  padding: 2rem;
  text-align: center;
  color: var(--text-secondary);
}

.qr-code-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.75rem;
  font-family: monospace;
  background: rgba(245, 158, 11, 0.15);
  color: #fcd34d;
  padding: 0.1rem 0.5rem;
  border-radius: 4px;
  border: 1px solid rgba(245, 158, 11, 0.3);
  width: fit-content;
}

@media (max-width: 768px) {
  .controls {
    flex-direction: column;
  }

  .used-parts-grid {
    grid-template-columns: 1fr;
  }
}
</style>
