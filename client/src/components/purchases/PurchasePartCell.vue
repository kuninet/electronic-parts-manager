<template>
  <div class="part-cell">
    <!-- ひも付け済み -->
    <template v-if="record.part_id">
      <div class="linked-line">
        <button
          type="button"
          class="part-link"
          :title="`部品「${record.part_name || ''}」を開く`"
          :disabled="busy"
          @click="$emit('open', record)"
        >
          {{ record.part_name || `部品 #${record.part_id}` }}
        </button>
      </div>
      <div class="cell-actions">
        <button type="button" class="btn btn-ghost btn-sm" :disabled="busy" @click="$emit('pick', record)">変更</button>
        <button type="button" class="btn btn-ghost btn-sm" :disabled="busy" @click="$emit('unlink', record)">解除</button>
      </div>
    </template>

    <!-- 候補あり -->
    <template v-else-if="record.suggested_part_id">
      <div class="suggest-line" :title="record.suggestion_note || undefined">
        <span class="suggest-badge">候補</span>
        <span class="suggest-name">{{ record.suggested_part_name || `部品 #${record.suggested_part_id}（削除済み?）` }}</span>
      </div>
      <div v-if="record.suggestion_note" class="suggest-note">{{ record.suggestion_note }}</div>
      <div class="cell-actions">
        <button type="button" class="btn btn-primary btn-sm" :disabled="busy" @click="$emit('approve', record)">承認</button>
        <button type="button" class="btn btn-secondary btn-sm" :disabled="busy" @click="$emit('reject', record)">却下</button>
        <button type="button" class="btn btn-ghost btn-sm" :disabled="busy" @click="$emit('pick', record)">別の部品</button>
      </div>
    </template>

    <!-- 未ひも付け -->
    <template v-else>
      <button type="button" class="btn btn-secondary btn-sm" :disabled="busy" @click="$emit('pick', record)">
        部品を選ぶ
      </button>
    </template>
  </div>
</template>

<script setup>
defineProps({
  record: { type: Object, required: true },
  busy: { type: Boolean, default: false }
});
defineEmits(['open', 'pick', 'unlink', 'approve', 'reject']);
</script>

<style scoped>
.part-cell {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.part-link {
  padding: 0;
  border: none;
  background: none;
  color: var(--accent-text);
  font-family: var(--font-sans);
  font-size: var(--fs-13);
  text-align: left;
  text-decoration: underline;
  cursor: pointer;
}

.part-link:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.suggest-line {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--fs-13);
  min-width: 0;
}

.suggest-badge {
  flex-shrink: 0;
  padding: 0 6px;
  border-radius: 10px;
  background: var(--warn-bg);
  color: var(--warn-fg);
  font-size: var(--fs-11);
  font-weight: 500;
}

.suggest-name {
  color: var(--text);
  overflow-wrap: anywhere;
}

.suggest-note {
  font-size: var(--fs-11);
  color: var(--text-3);
  overflow-wrap: anywhere;
}

.cell-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}
</style>
