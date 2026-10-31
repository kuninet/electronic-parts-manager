<template>
  <div class="picker-overlay" role="dialog" aria-modal="true" aria-labelledby="picker-title" @click.self="$emit('close')">
    <div ref="dialogRef" class="picker-card">
      <h3 id="picker-title" class="picker-title">{{ title }}</h3>
      <p class="picker-record">{{ recordLabel }}</p>

      <label class="picker-search">
        <AppIcon name="search" size="14" class="picker-search-icon" />
        <input
          ref="inputRef"
          v-model="query"
          type="search"
          class="picker-input"
          placeholder="部品名・型番で検索..."
          @keydown.enter.prevent="fetchParts"
        />
      </label>

      <div class="picker-list" role="listbox" aria-label="部品の検索結果">
        <div v-if="loading" class="picker-state">検索中...</div>
        <div v-else-if="error" class="picker-state error">{{ error }}</div>
        <div v-else-if="parts.length === 0" class="picker-state">該当する部品がありません</div>
        <button
          v-for="part in parts"
          v-else
          :key="part.id"
          type="button"
          class="picker-item"
          role="option"
          :disabled="saving"
          @click="$emit('select', part)"
        >
          <span class="picker-pn mono">{{ part.part_number || '-' }}</span>
          <span class="picker-nm">{{ part.name }}</span>
          <span v-if="part.used_at" class="picker-used">使用済み</span>
          <span v-if="part.location_name" class="picker-loc">{{ part.location_name }}</span>
        </button>
      </div>

      <div class="picker-actions">
        <button type="button" class="btn btn-secondary" @click="$emit('close')">キャンセル</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import api from '../../api';
import AppIcon from '../ui/AppIcon.vue';
import { initialPartSearch } from '../../utils/purchaseFormat.js';
import { FOCUSABLE_SELECTOR, nextTrapIndex } from '../../utils/focusTrap.js';

const props = defineProps({
  record: { type: Object, required: true },
  saving: { type: Boolean, default: false }
});
const emit = defineEmits(['close', 'select']);

const query = ref(initialPartSearch(props.record));
const parts = ref([]);
const loading = ref(false);
const error = ref(null);
const dialogRef = ref(null);
const inputRef = ref(null);

const title = computed(() => (props.record.part_id ? '部品を付け替える' : '部品を選ぶ'));
const recordLabel = computed(() => {
  const r = props.record;
  return [r.code, r.name].filter(Boolean).join(' / ');
});

// 古い検索結果で新しい結果を上書きしないよう、最後のリクエストだけ採用する
let requestSeq = 0;
const fetchParts = async () => {
  const seq = ++requestSeq;
  loading.value = true;
  error.value = null;
  try {
    const params = {};
    if (query.value.trim()) params.search = query.value.trim();
    // /parts は status 未指定だと使用済みを除く。購入した部品が使用済みでもひも付けられるよう、
    // 通常と used の 2 回取得して、通常を先にして結合する
    const [normal, used] = await Promise.all([
      api.get('/parts', { params }),
      api.get('/parts', { params: { ...params, status: 'used' } })
    ]);
    if (seq !== requestSeq) return;
    const merged = [
      ...(Array.isArray(normal.data) ? normal.data : []),
      ...(Array.isArray(used.data) ? used.data : [])
    ];
    parts.value = merged.slice(0, 50);
  } catch (err) {
    if (seq !== requestSeq) return;
    console.error(err);
    error.value = err.response?.data?.error || '部品の検索に失敗しました';
    parts.value = [];
  } finally {
    if (seq === requestSeq) loading.value = false;
  }
};

let timer;
watch(query, () => {
  clearTimeout(timer);
  timer = setTimeout(fetchParts, 300);
});

const onKeyDown = (e) => {
  if (e.isComposing) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    emit('close');
    return;
  }
  if (e.key === 'Tab' && dialogRef.value) {
    const focusable = Array.from(dialogRef.value.querySelectorAll(FOCUSABLE_SELECTOR));
    if (focusable.length === 0) return;
    e.preventDefault();
    const idx = focusable.indexOf(document.activeElement);
    const next = nextTrapIndex(idx, focusable.length, e.shiftKey);
    if (next >= 0 && focusable[next]) focusable[next].focus();
  }
};

onMounted(() => {
  window.addEventListener('keydown', onKeyDown);
  fetchParts();
  nextTick(() => inputRef.value?.focus());
});

onUnmounted(() => {
  clearTimeout(timer);
  window.removeEventListener('keydown', onKeyDown);
});
</script>

<style scoped>
.picker-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 200;
  padding: var(--space-4);
}

.picker-card {
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--space-5);
  width: 100%;
  max-width: 520px;
  max-height: 80dvh;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  box-shadow: var(--shadow-lg);
}

.picker-title {
  margin: 0;
  font-size: var(--fs-16);
  font-weight: 600;
}

.picker-record {
  margin: 0;
  font-size: var(--fs-12);
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-search {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: 32px;
  padding: 0 var(--space-2);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.picker-search:focus-within {
  border-color: var(--accent);
}

.picker-search-icon {
  color: var(--text-3);
}

.picker-input {
  flex: 1;
  height: 100%;
  border: none;
  background: transparent;
  color: var(--text);
  font-family: var(--font-sans);
  font-size: var(--fs-13);
  outline: none;
}

.picker-list {
  flex: 1;
  min-height: 120px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.picker-state {
  padding: var(--space-6) var(--space-4);
  text-align: center;
  font-size: var(--fs-13);
  color: var(--text-3);
}

.picker-state.error {
  color: var(--ng-fg);
}

.picker-item {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: none;
  border-bottom: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  font-family: var(--font-sans);
  font-size: var(--fs-13);
  text-align: left;
  cursor: pointer;
}

.picker-item:last-child {
  border-bottom: none;
}

.picker-item:hover:not(:disabled),
.picker-item:focus-visible {
  background: var(--surface-hover);
}

.picker-pn {
  font-weight: 500;
  flex-shrink: 0;
}

.picker-nm {
  flex: 1;
  min-width: 0;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-used {
  padding: 0 6px;
  border-radius: 10px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  font-size: var(--fs-11);
  color: var(--text-3);
  flex-shrink: 0;
}

.picker-loc {
  font-size: var(--fs-11);
  color: var(--text-3);
  flex-shrink: 0;
}

.picker-actions {
  display: flex;
  justify-content: flex-end;
}
</style>
