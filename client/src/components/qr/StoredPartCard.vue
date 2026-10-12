<template>
  <div
    class="stored-part-card"
    :class="[`status-${status}`]"
  >
    <!-- 左側: サムネイル画像 (40x40) -->
    <div class="card-thumb">
      <img
        v-if="part.image_path"
        :src="part.image_path"
        alt=""
        loading="lazy"
        decoding="async"
        class="thumb-img"
      />
      <div v-else class="thumb-placeholder">
        <AppIcon name="chip" :size="20" />
      </div>
    </div>

    <!-- 中央: 部品情報 -->
    <div class="card-body">
      <div class="card-title-row">
        <span class="part-name" :class="{ 'line-through': status === 'undone' }">
          {{ part.name }}
        </span>
      </div>

      <div v-if="part.part_number || part.quantity !== undefined" class="card-sub-row">
        <span v-if="part.part_number" class="part-number mono">{{ part.part_number }}</span>
        <span v-if="part.part_number" class="sub-sep">·</span>
        <span class="part-qty">×{{ part.quantity ?? 1 }}</span>
      </div>

      <!-- 状態別メッセージ行 -->
      <div class="card-status-row">
        <span v-if="status === 'undone'" class="status-msg text-undone">
          取り消しました（→ {{ item.restoredLocationName || '未設定' }}）
        </span>
        <span v-else-if="status === 'unchanged'" class="status-msg text-unchanged">
          既にこの保管場所にあります
        </span>
        <span v-else-if="status === 'error'" class="status-msg text-error">
          {{ item.error?.message || 'エラーが発生しました' }}
        </span>
        <span v-else class="status-msg text-location">
          元: {{ item.previousLocationName || '未設定' }}
        </span>
      </div>
    </div>

    <!-- 右側: 戻すボタン -->
    <div v-if="canShowUndoButton" class="card-actions">
      <button
        type="button"
        class="btn btn-secondary btn-sm undo-btn"
        :disabled="status === 'undoing'"
        @click="$emit('undo', item)"
      >
        {{ status === 'undoing' ? '戻しています…' : '戻す' }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import AppIcon from '../ui/AppIcon.vue';

const props = defineProps({
  item: {
    type: Object,
    required: true
  }
});

defineEmits(['undo']);

const status = computed(() => props.item?.status || 'stored');
const part = computed(() => props.item?.part || {});

const canShowUndoButton = computed(() => {
  if (status.value === 'stored' || status.value === 'undoing') {
    return true;
  }
  if (status.value === 'error') {
    return props.item?.error?.retryable !== false;
  }
  return false;
});
</script>

<style scoped>
@keyframes card-highlight {
  0% {
    background-color: var(--accent-soft);
  }
  100% {
    background-color: var(--surface);
  }
}

.stored-part-card {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2);
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  animation: card-highlight 0.6s ease-out;
  min-height: 56px;
}

.stored-part-card.status-undone {
  opacity: 0.6;
}

.card-thumb {
  width: 40px;
  height: 40px;
  min-width: 40px;
  min-height: 40px;
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.thumb-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.thumb-placeholder {
  color: var(--text-3);
  display: flex;
  align-items: center;
  justify-content: center;
}

.card-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.card-title-row {
  display: flex;
  align-items: center;
}

.part-name {
  font-size: var(--fs-14);
  font-weight: 500;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.part-name.line-through {
  text-decoration: line-through;
  color: var(--text-3);
}

.card-sub-row {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--fs-12);
  color: var(--text-2);
}

.part-number {
  color: var(--text-2);
}

.sub-sep {
  color: var(--text-3);
}

.part-qty {
  color: var(--text-2);
}

.card-status-row {
  font-size: var(--fs-11);
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.text-undone {
  color: var(--text-3);
}

.text-unchanged {
  color: var(--text-2);
}

.text-error {
  color: var(--ng-fg);
}

.text-location {
  color: var(--text-3);
}

.card-actions {
  flex-shrink: 0;
}

.undo-btn {
  white-space: nowrap;
}
</style>
