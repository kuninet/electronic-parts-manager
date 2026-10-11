<template>
  <aside class="app-sidebar" aria-label="サイドバーナビゲーション">
    <!-- ブランドロゴ -->
    <div class="brand">
      <div class="brand-logo" aria-hidden="true">
        <AppIcon name="chip" size="18" />
      </div>
      <span class="brand-name">電子パーツ管理</span>
    </div>

    <!-- ⌘K 検索ボタン -->
    <button
      type="button"
      class="cmd-search-btn"
      aria-label="検索とコマンド"
      @click="$emit('search')"
    >
      <AppIcon name="search" size="14" class="cmd-icon" />
      <span class="cmd-text">検索...</span>
      <kbd class="cmd-kbd">⌘K</kbd>
    </button>

    <!-- メインナビ -->
    <nav class="nav-section" aria-label="画面ナビゲーション">
      <button
        type="button"
        class="nav-item"
        :class="{ active: currentView === 'parts' && filters.categoryId.value === '' }"
        :aria-current="currentView === 'parts' && filters.categoryId.value === '' ? 'page' : undefined"
        @click="selectView('parts')"
      >
        <AppIcon name="grid" size="15" />
        <span class="nav-label">全パーツ</span>
        <span v-if="stats" class="nav-count mono">{{ stats.active }}</span>
      </button>

      <button
        type="button"
        class="nav-item"
        :class="{ active: currentView === 'used-parts' }"
        :aria-current="currentView === 'used-parts' ? 'page' : undefined"
        @click="selectView('used-parts')"
      >
        <AppIcon name="check" size="15" />
        <span class="nav-label">使用済み</span>
        <span v-if="stats" class="nav-count mono">{{ stats.used }}</span>
      </button>

      <button
        type="button"
        class="nav-item"
        :class="{ active: currentView === 'locations' }"
        :aria-current="currentView === 'locations' ? 'page' : undefined"
        @click="selectView('locations')"
      >
        <AppIcon name="box" size="15" />
        <span class="nav-label">保管庫ビュー</span>
        <span v-if="stats" class="nav-count mono">{{ stats.locations }}</span>
      </button>

      <button
        type="button"
        class="nav-item"
        @click="$emit('open-ai-review')"
      >
        <AppIcon name="spark" size="15" />
        <span class="nav-label">AI 判定候補</span>
        <span v-if="stats && stats.aiPending > 0" class="nav-pill mono">{{ stats.aiPending }}</span>
      </button>

      <a href="#/qr" class="nav-item qr-link">
        <AppIcon name="qr" size="15" />
        <span class="nav-label">QR 入出庫</span>
      </a>
    </nav>

    <!-- カテゴリ一覧 -->
    <div class="nav-group">
      <div class="group-title">カテゴリ</div>
      <div class="nav-section">
        <button
          type="button"
          class="nav-item sub"
          :class="{ active: currentView === 'parts' && filters.categoryId.value === '' }"
          :aria-pressed="filters.categoryId.value === ''"
          @click="selectCategory('')"
        >
          <span class="cat-dot-all"></span>
          <span class="nav-label">すべて</span>
          <span v-if="stats" class="nav-count mono">{{ stats.active }}</span>
        </button>

        <button
          v-for="cat in stats?.categories || []"
          :key="cat.id"
          type="button"
          class="nav-item sub"
          :class="{ active: currentView === 'parts' && filters.categoryId.value === String(cat.id) }"
          :aria-pressed="filters.categoryId.value === String(cat.id)"
          @click="selectCategory(String(cat.id))"
        >
          <span
            class="cat-dot"
            :style="{ backgroundColor: `var(--cat-${cat.id % 8})` }"
          ></span>
          <span class="nav-label">{{ cat.name }}</span>
          <span class="nav-count mono">{{ cat.count }}</span>
        </button>

        <button
          v-if="stats && stats.uncategorized > 0"
          type="button"
          class="nav-item sub"
          :class="{ active: currentView === 'parts' && filters.categoryId.value === 'none' }"
          :aria-pressed="filters.categoryId.value === 'none'"
          @click="selectCategory('none')"
        >
          <span class="cat-dot uncategorized"></span>
          <span class="nav-label">未分類</span>
          <span class="nav-count mono">{{ stats.uncategorized }}</span>
        </button>
      </div>
    </div>

    <!-- 設定 -->
    <div class="nav-group">
      <div class="group-title">設定</div>
      <div class="nav-section">
        <button
          type="button"
          class="nav-item"
          @click="$emit('open-qr-print')"
        >
          <AppIcon name="printer" size="15" />
          <span class="nav-label">QR 印刷</span>
        </button>

        <button
          type="button"
          class="nav-item"
          @click="$emit('open-master')"
        >
          <AppIcon name="sliders" size="15" />
          <span class="nav-label">マスタ管理</span>
        </button>

        <button
          type="button"
          class="nav-item"
          @click="$emit('open-data')"
        >
          <AppIcon name="database" size="15" />
          <span class="nav-label">データ管理</span>
        </button>
      </div>
    </div>

    <div class="sidebar-spacer"></div>

    <!-- 下端テーマ切替 -->
    <div class="sidebar-footer">
      <ThemeSwitch />
    </div>
  </aside>
</template>

<script setup>
import { usePartsStats } from '../../composables/usePartsStats';
import { usePartsFilters } from '../../composables/usePartsFilters';
import AppIcon from '../ui/AppIcon.vue';
import ThemeSwitch from './ThemeSwitch.vue';

defineProps({
  currentView: {
    type: String,
    required: true
  }
});

const emit = defineEmits([
  'navigate',
  'search',
  'open-ai-review',
  'open-qr-print',
  'open-master',
  'open-data'
]);

const { stats } = usePartsStats();
const filters = usePartsFilters();

const selectView = (view) => {
  if (view === 'parts') {
    filters.categoryId.value = '';
  }
  emit('navigate', view);
};

const selectCategory = (catId) => {
  filters.categoryId.value = catId;
  emit('navigate', 'parts');
};
</script>

<style scoped>
.app-sidebar {
  position: sticky;
  top: 0;
  height: 100dvh;
  overflow-y: auto;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border);
  padding: var(--space-4) var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-2);
}

.brand-logo {
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: var(--on-accent);
  display: flex;
  align-items: center;
  justify-content: center;
}

.brand-name {
  font-size: var(--fs-14);
  font-weight: 600;
  color: var(--text);
  letter-spacing: -0.2px;
}

.cmd-search-btn {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: 32px;
  padding: 0 var(--space-2);
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-2);
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: var(--fs-12);
  transition: border-color var(--dur);
}

.cmd-search-btn:hover {
  border-color: var(--border-strong);
  color: var(--text);
}

.cmd-icon {
  color: var(--text-3);
}

.cmd-text {
  flex: 1;
  text-align: left;
}

.cmd-kbd {
  font-family: var(--font-mono);
  font-size: var(--fs-11);
  padding: 1px 4px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-3);
}

.nav-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.group-title {
  font-size: var(--fs-11);
  font-weight: 500;
  color: var(--text-3);
  padding: 0 var(--space-2);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.nav-section {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: 32px;
  padding: 0 var(--space-2);
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-2);
  font-family: var(--font-sans);
  font-size: var(--fs-13);
  text-decoration: none;
  cursor: pointer;
  text-align: left;
  transition: background-color var(--dur), color var(--dur);
}

.nav-item:hover {
  background: var(--surface-hover);
  color: var(--text);
}

.nav-item.active {
  background: var(--surface-hover);
  color: var(--text);
  font-weight: 500;
}

.nav-item.sub {
  font-size: var(--fs-12);
}

.nav-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-count {
  font-size: var(--fs-11);
  color: var(--text-3);
}

.nav-pill {
  font-size: var(--fs-11);
  padding: 0 6px;
  border-radius: 10px;
  background: var(--accent-soft);
  color: var(--accent-text);
  font-weight: 500;
}

.cat-dot,
.cat-dot-all {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.cat-dot-all {
  background: var(--text-3);
}

.cat-dot.uncategorized {
  background: var(--text-3);
}

.sidebar-spacer {
  flex: 1;
}

.sidebar-footer {
  padding-top: var(--space-2);
  border-top: 1px solid var(--border);
}
</style>
