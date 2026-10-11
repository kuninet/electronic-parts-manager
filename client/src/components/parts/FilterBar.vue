<template>
  <div class="filter-bar">
    <!-- デスクトップ表示 -->
    <div class="filter-bar-desktop only-desktop">
      <div class="filter-left">
        <!-- ＋ フィルタ ポップオーバーボタン -->
        <div class="popover-wrapper">
          <button
            type="button"
            class="filter-add-btn"
            :aria-expanded="showFilterPopover"
            @click="showFilterPopover = !showFilterPopover"
          >
            <AppIcon name="plus" size="12" />
            <span>フィルタ</span>
          </button>

          <div v-if="showFilterPopover" class="filter-popover glass-panel">
            <div class="popover-field">
              <label class="popover-label">保管場所</label>
              <select v-model="filters.locationId.value" class="popover-select">
                <option value="">すべての場所</option>
                <option v-for="loc in locations" :key="loc.id" :value="String(loc.id)">
                  {{ loc.name }}
                </option>
              </select>
            </div>
            <div class="popover-field">
              <label class="popover-label">タグ</label>
              <select v-model="filters.tagId.value" class="popover-select">
                <option value="">すべてのタグ</option>
                <option v-for="t in tags" :key="t.id" :value="String(t.id)">
                  {{ t.name }}
                </option>
              </select>
            </div>
          </div>
        </div>

        <!-- 適用中フィルタトークン -->
        <div class="active-tokens">
          <span v-if="selectedCategoryName" class="filter-token">
            <span>カテゴリ = {{ selectedCategoryName }}</span>
            <button
              type="button"
              class="token-close"
              aria-label="カテゴリの絞り込みを解除"
              @click="filters.categoryId.value = ''"
            >
              <AppIcon name="x" size="10" />
            </button>
          </span>

          <span v-if="selectedLocationName" class="filter-token">
            <span>保管場所 = {{ selectedLocationName }}</span>
            <button
              type="button"
              class="token-close"
              aria-label="保管場所の絞り込みを解除"
              @click="filters.locationId.value = ''"
            >
              <AppIcon name="x" size="10" />
            </button>
          </span>

          <span v-if="selectedTagName" class="filter-token">
            <span>タグ = {{ selectedTagName }}</span>
            <button
              type="button"
              class="token-close"
              aria-label="タグの絞り込みを解除"
              @click="filters.tagId.value = ''"
            >
              <AppIcon name="x" size="10" />
            </button>
          </span>

          <span v-if="showTrash" class="filter-token trash">
            <span>ゴミ箱を表示中</span>
            <button
              type="button"
              class="token-close"
              aria-label="ゴミ箱の絞り込みを解除"
              @click="$emit('update:showTrash', false)"
            >
              <AppIcon name="x" size="10" />
            </button>
          </span>
        </div>
      </div>

      <div class="filter-right">
        <!-- 件数 -->
        <span class="count-badge mono">{{ count }} 件</span>

        <!-- 並び替えメニューボタン -->
        <div class="sort-menu-wrapper">
          <button
            type="button"
            class="btn btn-secondary btn-sm sort-btn"
            @click="showSortMenu = !showSortMenu"
          >
            <AppIcon name="sort" size="13" />
            <span>{{ sortLabel }}</span>
          </button>

          <div
            v-if="showSortMenu"
            class="sort-menu glass-panel"
            role="menu"
            @click.stop
          >
            <button
              type="button"
              class="menu-item"
              role="menuitemradio"
              :aria-checked="filters.sort.value === 'id'"
              @click="setSort('id')"
            >
              登録順
            </button>
            <button
              type="button"
              class="menu-item"
              role="menuitemradio"
              :aria-checked="filters.sort.value === 'name'"
              @click="setSort('name')"
            >
              名前順
            </button>
            <button
              type="button"
              class="menu-item"
              role="menuitemradio"
              :aria-checked="filters.sort.value === 'part_number'"
              @click="setSort('part_number')"
            >
              型番順
            </button>
            <button
              type="button"
              class="menu-item"
              role="menuitemradio"
              :aria-checked="filters.sort.value === 'category'"
              @click="setSort('category')"
            >
              カテゴリ順
            </button>
            <button
              type="button"
              class="menu-item"
              role="menuitemradio"
              :aria-checked="filters.sort.value === 'location'"
              @click="setSort('location')"
            >
              保管場所順
            </button>
            <button
              type="button"
              class="menu-item"
              role="menuitemradio"
              :aria-checked="filters.sort.value === 'quantity'"
              @click="setSort('quantity')"
            >
              個数順
            </button>

            <div class="menu-divider"></div>

            <button
              type="button"
              class="menu-item"
              role="menuitemradio"
              :aria-checked="filters.order.value === 'asc'"
              @click="filters.order.value = 'asc'; showSortMenu = false"
            >
              昇順
            </button>
            <button
              type="button"
              class="menu-item"
              role="menuitemradio"
              :aria-checked="filters.order.value === 'desc'"
              @click="filters.order.value = 'desc'; showSortMenu = false"
            >
              降順
            </button>
          </div>
        </div>

        <!-- S / M / L サイズ切替（グリッド時のみ） -->
        <div
          v-if="filters.viewMode.value === 'grid'"
          class="size-toggle"
          role="group"
          aria-label="カードサイズ"
        >
          <button
            type="button"
            class="size-btn mono"
            :class="{ active: filters.gridSize.value === 'small' }"
            :aria-pressed="filters.gridSize.value === 'small'"
            @click="filters.gridSize.value = 'small'"
          >
            S
          </button>
          <button
            type="button"
            class="size-btn mono"
            :class="{ active: filters.gridSize.value === 'medium' }"
            :aria-pressed="filters.gridSize.value === 'medium'"
            @click="filters.gridSize.value = 'medium'"
          >
            M
          </button>
          <button
            type="button"
            class="size-btn mono"
            :class="{ active: filters.gridSize.value === 'large' }"
            :aria-pressed="filters.gridSize.value === 'large'"
            @click="filters.gridSize.value = 'large'"
          >
            L
          </button>
        </div>

        <!-- ゴミ箱トグル -->
        <button
          type="button"
          class="btn btn-secondary btn-sm trash-toggle-btn"
          :class="{ active: showTrash }"
          :aria-pressed="showTrash"
          @click="$emit('update:showTrash', !showTrash)"
        >
          ゴミ箱
        </button>

        <!-- ✦ AI判定ボタン -->
        <button
          v-if="aiAvailable"
          type="button"
          class="btn btn-secondary btn-sm ai-btn"
          @click="$emit('open-ai-batch')"
        >
          <AppIcon name="spark" size="13" />
          <span>AI判定</span>
        </button>
      </div>
    </div>

    <!-- モバイル表示（横スクロールチップ） -->
    <div class="filter-bar-mobile only-mobile">
      <div class="chip-scroll">
        <button
          type="button"
          class="chip-btn"
          :class="{ active: filters.categoryId.value === '' }"
          :aria-pressed="filters.categoryId.value === ''"
          @click="filters.categoryId.value = ''"
        >
          すべて
        </button>

        <button
          v-for="cat in categories"
          :key="cat.id"
          type="button"
          class="chip-btn"
          :class="{ active: filters.categoryId.value === String(cat.id) }"
          :aria-pressed="filters.categoryId.value === String(cat.id)"
          @click="filters.categoryId.value = String(cat.id)"
        >
          {{ cat.name }}
        </button>

        <button
          type="button"
          class="chip-btn"
          :class="{ active: filters.categoryId.value === 'none' }"
          :aria-pressed="filters.categoryId.value === 'none'"
          @click="filters.categoryId.value = 'none'"
        >
          未分類
        </button>
      </div>

      <!-- モバイルその他メニュー（並び替え・ゴミ箱） -->
      <div class="mobile-more-wrapper">
        <button
          type="button"
          class="btn btn-secondary btn-icon mobile-more-btn"
          aria-label="並び替えとその他のフィルタ"
          @click="showMobileMenu = !showMobileMenu"
        >
          <AppIcon name="more" size="16" />
        </button>

        <div v-if="showMobileMenu" class="sort-menu glass-panel mobile-popup" @click.stop>
          <div class="menu-header">並び替え</div>
          <button type="button" class="menu-item" @click="setSort('id')">登録順</button>
          <button type="button" class="menu-item" @click="setSort('name')">名前順</button>
          <button type="button" class="menu-item" @click="setSort('part_number')">型番順</button>
          <button type="button" class="menu-item" @click="setSort('quantity')">個数順</button>
          <div class="menu-divider"></div>
          <button
            type="button"
            class="menu-item"
            :class="{ active: showTrash }"
            @click="$emit('update:showTrash', !showTrash); showMobileMenu = false"
          >
            {{ showTrash ? '✓ ゴミ箱を非表示' : 'ゴミ箱を表示' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { usePartsFilters } from '../../composables/usePartsFilters';
import AppIcon from '../ui/AppIcon.vue';

const props = defineProps({
  categories: {
    type: Array,
    default: () => []
  },
  locations: {
    type: Array,
    default: () => []
  },
  tags: {
    type: Array,
    default: () => []
  },
  count: {
    type: Number,
    default: 0
  },
  showTrash: {
    type: Boolean,
    default: false
  },
  aiAvailable: {
    type: Boolean,
    default: false
  }
});

defineEmits(['update:showTrash', 'open-ai-batch']);

const filters = usePartsFilters();

const showFilterPopover = ref(false);
const showSortMenu = ref(false);
const showMobileMenu = ref(false);

const selectedCategoryName = computed(() => {
  if (!filters.categoryId.value) return null;
  if (filters.categoryId.value === 'none') return '未分類';
  const c = props.categories.find((cat) => String(cat.id) === filters.categoryId.value);
  return c ? c.name : null;
});

const selectedLocationName = computed(() => {
  if (!filters.locationId.value) return null;
  const l = props.locations.find((loc) => String(loc.id) === filters.locationId.value);
  return l ? l.name : null;
});

const selectedTagName = computed(() => {
  if (!filters.tagId.value) return null;
  const t = props.tags.find((tag) => String(tag.id) === filters.tagId.value);
  return t ? t.name : null;
});

const sortLabels = {
  id: '登録順',
  name: '名前順',
  part_number: '型番順',
  category: 'カテゴリ順',
  location: '保管場所順',
  quantity: '個数順'
};

const sortLabel = computed(() => {
  const name = sortLabels[filters.sort.value] || '並び替え';
  const dir = filters.order.value === 'asc' ? '↑' : '↓';
  return `${name} ${dir}`;
});

const setSort = (sortField) => {
  filters.sort.value = sortField;
  showSortMenu.value = false;
  showMobileMenu.value = false;
};
</script>

<style scoped>
.filter-bar {
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  position: relative;
  z-index: 10;
}

/* デスクトップ表示 */
.filter-bar-desktop {
  padding: 10px var(--space-5);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.filter-left {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.popover-wrapper {
  position: relative;
}

.filter-add-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  height: 28px;
  padding: 0 var(--space-2);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-2);
  font-family: var(--font-sans);
  font-size: var(--fs-12);
  cursor: pointer;
  transition: border-color var(--dur), color var(--dur);
}

.filter-add-btn:hover {
  border-color: var(--accent);
  color: var(--text);
}

.filter-popover {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 4px;
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: 200px;
  z-index: 30;
  box-shadow: var(--shadow-lg);
}

.popover-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.popover-label {
  font-size: var(--fs-11);
  color: var(--text-3);
}

.popover-select {
  height: 28px;
  padding: 0 var(--space-1);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: var(--fs-12);
}

.active-tokens {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex-wrap: wrap;
}

.filter-token {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  height: 26px;
  padding: 0 var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: var(--fs-12);
}

.filter-token.trash {
  background: var(--warn-bg);
  color: var(--warn-fg);
  border-color: var(--warn);
}

.token-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  padding: 0;
}

.token-close:hover {
  color: var(--text);
}

.filter-right {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-left: auto;
}

.count-badge {
  font-size: var(--fs-12);
  color: var(--text-3);
}

.sort-menu-wrapper {
  position: relative;
}

.sort-menu {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  padding: 4px;
  display: flex;
  flex-direction: column;
  min-width: 140px;
  z-index: 30;
  box-shadow: var(--shadow-lg);
}

.menu-item {
  display: flex;
  align-items: center;
  height: 28px;
  padding: 0 var(--space-2);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-2);
  font-size: var(--fs-12);
  cursor: pointer;
  text-align: left;
}

.menu-item:hover {
  background: var(--surface-hover);
  color: var(--text);
}

.menu-item[aria-checked="true"],
.menu-item.active {
  color: var(--accent-text);
  font-weight: 500;
}

.menu-divider {
  height: 1px;
  background: var(--border);
  margin: 4px 0;
}

.size-toggle {
  display: flex;
  align-items: center;
  padding: 2px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.size-btn {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-3);
  font-size: var(--fs-11);
  font-weight: 500;
  cursor: pointer;
}

.size-btn:hover {
  color: var(--text);
}

.size-btn.active {
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow-sm);
}

.trash-toggle-btn.active {
  background: var(--warn-bg);
  color: var(--warn-fg);
  border-color: var(--warn);
}

.ai-btn {
  color: var(--accent-text);
}

/* モバイル表示 */
.filter-bar-mobile {
  display: flex;
  align-items: center;
  padding: var(--space-2) var(--space-3);
  gap: var(--space-2);
}

.chip-scroll {
  flex: 1;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  overflow-x: auto;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}

.chip-scroll::-webkit-scrollbar {
  display: none;
}

.chip-btn {
  height: 32px;
  padding: 0 var(--space-3);
  border-radius: 16px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-2);
  font-family: var(--font-sans);
  font-size: var(--fs-13);
  white-space: nowrap;
  cursor: pointer;
  transition: background-color var(--dur), border-color var(--dur), color var(--dur);
}

.chip-btn:hover {
  color: var(--text);
}

.chip-btn.active {
  background: var(--surface-hover);
  color: var(--text);
  border-color: var(--border-strong);
  font-weight: 500;
}

.mobile-more-wrapper {
  position: relative;
}

.mobile-more-btn {
  width: 32px;
  height: 32px;
}

.mobile-popup {
  right: 0;
  top: 100%;
}

.menu-header {
  font-size: var(--fs-11);
  color: var(--text-3);
  padding: 4px var(--space-2);
}
</style>
