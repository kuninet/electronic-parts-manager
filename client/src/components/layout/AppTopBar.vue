<template>
  <header class="app-topbar">
    <!-- デスクトップ表示 -->
    <div class="topbar-desktop only-desktop">
      <div class="breadcrumbs">
        <span class="crumb-parent">パーツ</span>
        <span class="crumb-sep">/</span>
        <span class="crumb-current">{{ viewTitle }}</span>
      </div>

      <div v-if="currentView === 'parts'" class="search-box">
        <label class="search-label">
          <span class="sr-only">部品を検索</span>
          <AppIcon name="search" size="15" class="search-icon" />
          <input
            ref="searchInputRef"
            v-model="filters.query.value"
            type="search"
            class="search-input"
            placeholder="名前・型番・保管場所で絞り込み"
          />
          <kbd class="shortcut-badge">/</kbd>
        </label>
      </div>
      <div v-else class="topbar-spacer"></div>

      <div v-if="currentView === 'parts'" class="topbar-actions">
        <!-- 表示切替 -->
        <div class="view-mode-toggle" role="group" aria-label="表示モード">
          <button
            type="button"
            class="mode-btn"
            :class="{ active: filters.viewMode.value === 'grid' }"
            :aria-pressed="filters.viewMode.value === 'grid'"
            aria-label="グリッド表示"
            @click="filters.viewMode.value = 'grid'"
          >
            <AppIcon name="grid" size="15" />
          </button>
          <button
            type="button"
            class="mode-btn"
            :class="{ active: filters.viewMode.value === 'list' }"
            :aria-pressed="filters.viewMode.value === 'list'"
            aria-label="リスト表示"
            @click="filters.viewMode.value = 'list'"
          >
            <AppIcon name="list" size="15" />
          </button>
        </div>

        <!-- カメラボタン -->
        <button
          type="button"
          class="btn btn-secondary btn-icon"
          aria-label="画像から追加"
          :disabled="uploading"
          @click="$emit('camera')"
        >
          <AppIcon name="camera" size="16" />
        </button>

        <!-- ＋パーツ追加 -->
        <button
          type="button"
          class="btn btn-primary add-part-btn"
          @click="$emit('add')"
        >
          <AppIcon name="plus" size="14" />
          <span>パーツ追加</span>
          <kbd class="shortcut-badge on-primary">N</kbd>
        </button>
      </div>
    </div>

    <!-- モバイル表示 -->
    <div class="topbar-mobile only-mobile">
      <div class="mobile-row-top">
        <div class="mobile-title-wrap">
          <h1 class="mobile-view-title">{{ viewTitle }}</h1>
          <span v-if="currentView === 'parts' && stats?.active" class="mobile-count mono">
            {{ stats.active }}
          </span>
        </div>
        <a href="#/qr" class="mobile-qr-btn btn btn-secondary btn-icon" aria-label="QR入出庫">
          <AppIcon name="qr" size="18" />
        </a>
      </div>

      <div v-if="currentView === 'parts'" class="mobile-search-row">
        <label class="search-label mobile">
          <span class="sr-only">部品を検索</span>
          <AppIcon name="search" size="16" class="search-icon" />
          <input
            ref="mobileSearchInputRef"
            v-model="filters.query.value"
            type="search"
            class="search-input mobile"
            placeholder="名前・型番・保管場所"
          />
        </label>
      </div>
    </div>
  </header>
</template>

<script setup>
import { ref, computed } from 'vue';
import { usePartsFilters } from '../../composables/usePartsFilters';
import { usePartsStats } from '../../composables/usePartsStats';
import AppIcon from '../ui/AppIcon.vue';

const props = defineProps({
  currentView: {
    type: String,
    required: true
  },
  uploading: {
    type: Boolean,
    default: false
  }
});

defineEmits(['add', 'camera']);

const filters = usePartsFilters();
const { stats } = usePartsStats();

const searchInputRef = ref(null);
const mobileSearchInputRef = ref(null);

const viewTitle = computed(() => {
  switch (props.currentView) {
    case 'parts':
      return '全パーツ';
    case 'used-parts':
      return '使用済み';
    case 'locations':
      return '保管庫ビュー';
    default:
      return '';
  }
});

const focusSearch = () => {
  if (searchInputRef.value && searchInputRef.value.offsetParent !== null) {
    searchInputRef.value.focus();
    searchInputRef.value.select?.();
  } else if (mobileSearchInputRef.value) {
    mobileSearchInputRef.value.focus();
    mobileSearchInputRef.value.select?.();
  }
};

defineExpose({
  focusSearch
});
</script>

<style scoped>
.app-topbar {
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 20;
}

/* デスクトップ用 */
.topbar-desktop {
  height: var(--topbar-h);
  padding: 0 var(--space-5);
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.breadcrumbs {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--fs-13);
  white-space: nowrap;
}

.crumb-parent {
  color: var(--text-3);
}

.crumb-sep {
  color: var(--text-3);
}

.crumb-current {
  color: var(--text);
  font-weight: 500;
}

.topbar-spacer {
  flex: 1;
}

.search-box {
  flex: 1;
  max-width: 440px;
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
  transition: border-color var(--dur);
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

.shortcut-badge {
  font-family: var(--font-mono);
  font-size: var(--fs-11);
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text-3);
}

.shortcut-badge.on-primary {
  background: rgba(255, 255, 255, 0.2); /* theme-exempt: アクセント上の半透明ハイライト */
  border: none;
  color: var(--on-accent);
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-left: auto;
}

.view-mode-toggle {
  display: flex;
  align-items: center;
  padding: 2px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.mode-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  transition: background-color var(--dur), color var(--dur);
}

.mode-btn:hover {
  color: var(--text);
}

.mode-btn.active {
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow-sm);
}

.add-part-btn {
  height: 32px;
  padding: 0 var(--space-3);
  gap: var(--space-2);
}

/* モバイル用 */
.topbar-mobile {
  padding: var(--space-3) var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.mobile-row-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.mobile-title-wrap {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}

.mobile-view-title {
  font-size: var(--fs-20);
  font-weight: 600;
  color: var(--text);
  margin: 0;
}

.mobile-count {
  font-size: var(--fs-13);
  color: var(--text-3);
}

.mobile-qr-btn {
  width: 44px;
  height: 44px;
}

.mobile-search-row {
  margin-top: var(--space-1);
}

.search-label.mobile {
  height: 40px;
  padding: 0 var(--space-3);
}

.search-input.mobile {
  font-size: 16px;
}
</style>
