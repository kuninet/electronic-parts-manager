<template>
  <article
    class="part-card"
    :class="{ selected }"
    :data-part-id="part.id"
  >
    <!-- 写真とステータスバッジ -->
    <div class="photo-wrap">
      <button
        type="button"
        class="photo-btn"
        :class="{ 'no-photo': !hasPreviewablePhoto(part) }"
        :aria-label="photoAriaLabel"
        @click="onPhotoClick"
      >
        <img
          v-if="visible && part.image_path"
          :src="part.image_path"
          alt=""
          loading="lazy"
          decoding="async"
          class="photo-img"
        />
        <div v-else class="photo-placeholder" aria-hidden="true">
          <AppIcon name="chip" size="40" />
        </div>
      </button>

      <!-- チェックボックス（ホバー時または選択モード時に表示） -->
      <label
        class="select-label"
        :class="{ 'always-visible': selectionMode }"
        @mousedown="onCheckboxMouseDown"
        @pointerdown="$emit('select-pointerdown', $event)"
      >
        <input
          type="checkbox"
          :checked="selected"
          :aria-label="`${part.name} を選択`"
          class="select-checkbox"
          @click="$emit('toggle-select', { shiftKey: $event.shiftKey, event: $event })"
          @mousedown="onCheckboxMouseDown"
          @pointerdown.stop="$emit('select-pointerdown', $event)"
        />
      </label>

      <!-- 在庫ステータスバッジ -->
      <span class="status-badge" :class="`s-${status}`">
        <i class="status-dot"></i>
        <span>{{ statusLabel }}</span>
      </span>
    </div>

    <!-- カード本体 -->
    <div class="card-body">
      <!-- タイトル（クリックで編集モーダルを開く） -->
      <button class="title-btn" type="button" @click="$emit('edit')">
        <template v-if="part.part_number">
          <span class="pn mono">
            <template v-for="(seg, i) in hl(part.part_number)" :key="i">
              <mark v-if="seg.match" class="hl">{{ seg.text }}</mark>
              <template v-else>{{ seg.text }}</template>
            </template>
          </span>
          <span class="nm">
            <template v-for="(seg, i) in hl(part.name)" :key="i">
              <mark v-if="seg.match" class="hl">{{ seg.text }}</mark>
              <template v-else>{{ seg.text }}</template>
            </template>
          </span>
        </template>
        <template v-else>
          <span class="nm-main">
            <template v-for="(seg, i) in hl(part.name)" :key="i">
              <mark v-if="seg.match" class="hl">{{ seg.text }}</mark>
              <template v-else>{{ seg.text }}</template>
            </template>
          </span>
        </template>
      </button>

      <!-- メタ情報 -->
      <div class="card-meta">
        <span
          class="meta-dot"
          :style="{ backgroundColor: part.category_id ? `var(--cat-${part.category_id % 8})` : 'var(--text-3)' }"
        ></span>
        <span class="meta-cat">{{ part.category_name || '未分類' }}</span>
        <span class="meta-sep">·</span>
        <span class="meta-loc">{{ part.location_name || '場所未設定' }}</span>
        <span v-if="part.qr_code" class="qr-code mono">{{ part.qr_code }}</span>
      </div>

      <!-- タグ（先頭2件 + +n） -->
      <div v-if="tagList.length > 0" class="card-tags">
        <span v-for="t in tagList.slice(0, 2)" :key="t" class="tag-badge">
          {{ t }}
        </span>
        <span v-if="tagList.length > 2" class="tag-more">
          +{{ tagList.length - 2 }}
        </span>
      </div>

      <!-- 在庫バー -->
      <div
        class="stock-bar"
        role="img"
        :aria-label="`在庫レベル ${stockPct}%`"
      >
        <div class="stock-fill" :class="`b-${status}`" :style="{ width: `${stockPct}%` }"></div>
      </div>

      <!-- フッター（ステッパー） -->
      <div class="card-foot">
        <div class="foot-spacer"></div>
        <QuantityStepper :part="part" size="sm" />
      </div>
    </div>
  </article>
</template>

<script setup>
import { computed } from 'vue';
import { LOW_STOCK_THRESHOLD } from '../../constants';
import { useQuantitySync } from '../../composables/useQuantitySync';
import { usePartsFilters } from '../../composables/usePartsFilters';
import { splitByQuery } from '../../utils/highlight';
import { hasPreviewablePhoto } from '../../utils/photoPreview';
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
  selectionMode: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['edit', 'toggle-select', 'quick-update', 'preview', 'select-pointerdown']);

const onCheckboxMouseDown = (event) => {
  if (event.shiftKey) {
    event.preventDefault();
  }
};

const onPhotoClick = () => {
  if (hasPreviewablePhoto(props.part)) emit('preview');
  else emit('edit');
};

const photoAriaLabel = computed(() => {
  return hasPreviewablePhoto(props.part)
    ? `${props.part.name} の写真を拡大`
    : `${props.part.name} を編集`;
});

const qtySync = useQuantitySync();
const filters = usePartsFilters();

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

const stockPct = computed(() => {
  return Math.min(100, Math.round((qty.value / (LOW_STOCK_THRESHOLD * 4)) * 100));
});

const tagList = computed(() => {
  if (!props.part.tags) return [];
  if (Array.isArray(props.part.tags)) {
    return props.part.tags.map((t) => (typeof t === 'string' ? t : t.name));
  }
  if (typeof props.part.tags === 'string') {
    return props.part.tags.split(',').filter(Boolean);
  }
  return [];
});

const hl = (text) => {
  return splitByQuery(text, filters.query.value);
};
</script>

<style scoped>
.part-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  transition: border-color var(--dur), box-shadow var(--dur);
  position: relative;
}

.part-card:hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-md);
}

.part-card.selected {
  outline: 2px solid var(--accent);
  outline-offset: -1px;
}

/* 写真部分 */
.photo-wrap {
  position: relative;
  aspect-ratio: 4 / 3;
  width: 100%;
  background: var(--surface-2);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.photo-btn {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
  padding: 0;
  background: none;
  cursor: zoom-in;
  display: flex;
  align-items: center;
  justify-content: center;
}

.photo-btn.no-photo {
  cursor: pointer;
}

.photo-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.photo-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.photo-placeholder {
  color: var(--text-3);
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 選択チェックボックス */
.select-label {
  position: absolute;
  top: var(--space-2);
  left: var(--space-2);
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  background: var(--surface);
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--dur);
  box-shadow: var(--shadow-sm);
  user-select: none;
}

.part-card:hover .select-label,
.select-label.always-visible {
  opacity: 1;
}

.select-checkbox {
  cursor: pointer;
  accent-color: var(--accent);
}

/* ステータスバッジ */
.status-badge {
  position: absolute;
  top: var(--space-2);
  right: var(--space-2);
  height: 20px;
  padding: 0 var(--space-2);
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--fs-11);
  font-weight: 500;
  pointer-events: none;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.status-badge.s-ok {
  background: var(--ok-bg);
  color: var(--ok-fg);
}
.status-badge.s-ok .status-dot {
  background: var(--ok);
}

.status-badge.s-warn {
  background: var(--warn-bg);
  color: var(--warn-fg);
}
.status-badge.s-warn .status-dot {
  background: var(--warn);
}

.status-badge.s-ng {
  background: var(--ng-bg);
  color: var(--ng-fg);
}
.status-badge.s-ng .status-dot {
  background: var(--ng);
}

/* カードボディ */
.card-body {
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  flex: 1;
}

.title-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  width: 100%;
}

.pn {
  font-size: var(--fs-13);
  font-weight: 500;
  color: var(--text);
  line-height: 1.3;
}

.nm {
  font-size: var(--fs-12);
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  width: 100%;
  line-height: 1.3;
}

.nm-main {
  font-size: var(--fs-13);
  font-weight: 500;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  width: 100%;
}

.hl {
  background: var(--accent-soft);
  color: var(--accent-text);
  border-radius: 2px;
  padding: 0 1px;
}

/* メタ行 */
.card-meta {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--fs-11);
  color: var(--text-3);
  margin-top: 2px;
}

.meta-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.meta-cat,
.meta-loc {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta-sep {
  color: var(--text-3);
}

.qr-code {
  margin-left: auto;
  font-size: var(--fs-11);
  color: var(--text-3);
  flex-shrink: 0;
}

/* タグ */
.card-tags {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin-top: 2px;
}

.tag-badge {
  font-size: var(--fs-11);
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text-2);
  border: 1px solid var(--border);
}

.tag-more {
  font-size: var(--fs-11);
  color: var(--text-3);
}

/* 在庫バー */
.stock-bar {
  height: 3px;
  width: 100%;
  background: var(--surface-2);
  border-radius: 2px;
  overflow: hidden;
  margin-top: var(--space-2);
}

.stock-fill {
  height: 100%;
  border-radius: 2px;
  transition: width var(--dur) var(--ease);
}

.stock-fill.b-ok {
  background: var(--ok);
}

.stock-fill.b-warn {
  background: var(--warn);
}

.stock-fill.b-ng {
  background: var(--ng);
}

/* フッター */
.card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: var(--space-2);
}

.foot-spacer {
  flex: 1;
}
</style>
