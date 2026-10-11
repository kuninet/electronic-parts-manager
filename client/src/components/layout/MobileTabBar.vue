<template>
  <nav class="mobile-tab-bar" aria-label="メインナビゲーション">
    <button
      type="button"
      class="tab-item"
      :class="{ active: currentView === 'parts' }"
      :aria-current="currentView === 'parts' ? 'page' : undefined"
      @click="$emit('navigate', 'parts')"
    >
      <AppIcon name="grid" size="20" />
      <span>パーツ</span>
    </button>
    <button
      type="button"
      class="tab-item"
      :class="{ active: currentView === 'used-parts' }"
      :aria-current="currentView === 'used-parts' ? 'page' : undefined"
      @click="$emit('navigate', 'used-parts')"
    >
      <AppIcon name="check" size="20" />
      <span>使用済み</span>
    </button>
    <a
      href="#/qr"
      class="tab-item qr-link"
      :class="{ active: currentView === 'qr' }"
      :aria-current="currentView === 'qr' ? 'page' : undefined"
    >
      <AppIcon name="qr" size="20" />
      <span>QR</span>
    </a>
    <button
      type="button"
      class="tab-item"
      :class="{ active: currentView === 'locations' }"
      :aria-current="currentView === 'locations' ? 'page' : undefined"
      @click="$emit('navigate', 'locations')"
    >
      <AppIcon name="box" size="20" />
      <span>保管庫</span>
    </button>
    <button
      type="button"
      class="tab-item"
      @click="$emit('more')"
    >
      <AppIcon name="more" size="20" />
      <span>その他</span>
    </button>
  </nav>
</template>

<script setup>
import AppIcon from '../ui/AppIcon.vue';

defineProps({
  currentView: {
    type: String,
    required: true
  }
});

defineEmits(['navigate', 'more']);
</script>

<style scoped>
.mobile-tab-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  height: calc(var(--tabbar-h) + env(safe-area-inset-bottom));
  padding-bottom: env(safe-area-inset-bottom);
  z-index: 50;
  background: var(--bg-sidebar);
  border-top: 1px solid var(--border);
  display: flex;
  align-items: stretch;
}

.tab-item {
  flex: 1;
  height: var(--tabbar-h);
  border: none;
  background: transparent;
  color: var(--text-3);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  cursor: pointer;
  text-decoration: none;
  font-family: var(--font-sans);
  font-size: var(--fs-11);
  padding: 0;
  transition: color var(--dur);
}

.tab-item:hover {
  color: var(--text);
}

.tab-item.active {
  color: var(--accent-text);
  font-weight: 500;
}
</style>
