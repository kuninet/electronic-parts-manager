<template>
  <!-- Table モード (デスクトップリスト表示用: <tr>) -->
  <tr
    v-if="mode === 'table'"
    class="part-row-table"
    :class="{ selected }"
    :data-part-id="part.id"
  >
    <td class="col-check">
      <input
        type="checkbox"
        :checked="selected"
        :aria-label="`${part.name} を選択`"
        class="select-checkbox"
        @change="$emit('toggle-select')"
      />
    </td>
    <td class="col-thumb">
      <div class="thumb-box-40">
        <img
          v-if="visible && part.image_path"
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
      <button type="button" class="row-title-btn" @click="$emit('edit')">
        <span v-if="part.part_number" class="row-pn mono">{{ part.part_number }}</span>
        <span class="row-nm">{{ part.name }}</span>
      </button>
    </td>
    <td class="col-cat">
      <div class="cat-pill">
        <span
          class="cat-dot"
          :style="{ backgroundColor: part.category_id ? `var(--cat-${part.category_id % 8})` : 'var(--text-3)' }"
        ></span>
        <span>{{ part.category_name || '未分類' }}</span>
      </div>
    </td>
    <td class="col-loc">
      <span class="loc-text">{{ part.location_name || '場所未設定' }}</span>
    </td>
    <td class="col-stock">
      <div class="stock-cell">
        <span class="status-indicator" :class="`s-${status}`">
          <i class="indicator-dot"></i>
          <span class="indicator-text">{{ statusLabel }}</span>
        </span>
        <QuantityStepper :part="part" size="sm" />
      </div>
    </td>
    <td class="col-action">
      <button type="button" class="btn btn-secondary btn-sm" @click="$emit('edit')">
        編集
      </button>
    </td>
  </tr>

  <!-- Stack モード (モバイル表示用: <div>) -->
  <article
    v-else
    class="part-row-stack"
    :class="{ selected }"
    :data-part-id="part.id"
    @click="$emit('edit')"
  >
    <div class="stack-thumb-wrap">
      <div class="thumb-box-52">
        <img
          v-if="visible && part.image_path"
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
    </div>

    <div class="stack-body">
      <div class="stack-titles">
        <span v-if="part.part_number" class="stack-pn mono">{{ part.part_number }}</span>
        <h2 class="stack-nm">{{ part.name }}</h2>
      </div>
      <div class="stack-sub">
        <span class="status-indicator-inline" :class="`s-${status}`">
          <i class="indicator-dot"></i>
          <span>{{ statusLabel }}</span>
        </span>
        <span class="sub-sep">·</span>
        <span class="sub-loc">{{ part.location_name || '場所未設定' }}</span>
      </div>
    </div>

    <div class="stack-stepper" @click.stop>
      <QuantityStepper :part="part" size="md" />
    </div>
  </article>
</template>

<script setup>
import { computed } from 'vue';
import { LOW_STOCK_THRESHOLD } from '../../constants';
import { useQuantitySync } from '../../composables/useQuantitySync';
import AppIcon from '../ui/AppIcon.vue';
import QuantityStepper from './QuantityStepper.vue';

const props = defineProps({
  part: {
    type: Object,
    required: true
  },
  selected: {
    type: Boolean,
    default: false
  },
  visible: {
    type: Boolean,
    default: true
  },
  mode: {
    type: String,
    default: 'table',
    validator: (v) => ['table', 'stack'].includes(v)
  }
});

defineEmits(['edit', 'toggle-select']);

const qtySync = useQuantitySync();

const qty = computed(() => {
  return qtySync.displayOf(props.part);
});

const status = computed(() => {
  if (qty.value === 0) return 'ng';
  if (qty.value < LOW_STOCK_THRESHOLD) return 'warn';
  return 'ok';
});

const statusLabel = computed(() => {
  if (status.value === 'ng') return '在庫切れ';
  if (status.value === 'warn') return '残りわずか';
  return '在庫あり';
});
</script>

<style scoped>
/* テーブル行スタイル */
.part-row-table td {
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
  background: var(--surface);
  transition: background-color var(--dur);
}

.part-row-table:hover td {
  background: var(--surface-hover);
}

.part-row-table.selected td {
  background: var(--accent-soft);
}

.col-check {
  width: 32px;
  text-align: center;
}

.select-checkbox {
  cursor: pointer;
  accent-color: var(--accent);
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

.thumb-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.thumb-placeholder {
  color: var(--text-3);
}

.row-title-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  text-align: left;
}

.row-pn {
  font-size: var(--fs-13);
  font-weight: 500;
  color: var(--text);
}

.row-nm {
  font-size: var(--fs-12);
  color: var(--text-2);
}

.cat-pill {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--fs-12);
  color: var(--text-2);
}

.cat-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.loc-text {
  font-size: var(--fs-12);
  color: var(--text-3);
}

.stock-cell {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.status-indicator {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--fs-11);
  min-width: 68px;
}

.indicator-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.status-indicator.s-ok .indicator-dot { background: var(--ok); }
.status-indicator.s-ok .indicator-text { color: var(--ok-fg); }
.status-indicator.s-warn .indicator-dot { background: var(--warn); }
.status-indicator.s-warn .indicator-text { color: var(--warn-fg); }
.status-indicator.s-ng .indicator-dot { background: var(--ng); }
.status-indicator.s-ng .indicator-text { color: var(--ng-fg); }

/* モバイル Stack スタイル */
.part-row-stack {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  transition: background-color var(--dur);
}

.part-row-stack:hover {
  background: var(--surface-hover);
}

.part-row-stack.selected {
  background: var(--accent-soft);
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
}

.stack-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stack-titles {
  display: flex;
  flex-direction: column;
}

.stack-pn {
  font-size: var(--fs-13);
  font-weight: 500;
  color: var(--text);
  line-height: 1.3;
}

.stack-nm {
  font-size: var(--fs-12);
  font-weight: normal;
  color: var(--text-2);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
}

.stack-sub {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--fs-11);
  color: var(--text-3);
}

.status-indicator-inline {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.status-indicator-inline.s-ok { color: var(--ok-fg); }
.status-indicator-inline.s-ok .indicator-dot { background: var(--ok); }
.status-indicator-inline.s-warn { color: var(--warn-fg); }
.status-indicator-inline.s-warn .indicator-dot { background: var(--warn); }
.status-indicator-inline.s-ng { color: var(--ng-fg); }
.status-indicator-inline.s-ng .indicator-dot { background: var(--ng); }

.sub-sep {
  color: var(--text-3);
}

.sub-loc {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stack-stepper {
  flex-shrink: 0;
}
</style>
