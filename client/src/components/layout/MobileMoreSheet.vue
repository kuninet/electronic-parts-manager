<template>
  <div class="sheet-backdrop" @click.self="$emit('close')">
    <div
      ref="sheetRef"
      class="sheet-container"
      role="dialog"
      aria-modal="true"
      aria-label="その他のメニュー"
    >
      <div class="sheet-handle" aria-hidden="true"></div>
      
      <div class="sheet-menu">
        <button
          ref="firstItemRef"
          type="button"
          class="menu-item"
          @click="$emit('add'); $emit('close')"
        >
          <AppIcon name="plus" size="18" />
          <span class="menu-label">パーツを追加</span>
        </button>

        <button
          type="button"
          class="menu-item"
          @click="$emit('open-ai-review'); $emit('close')"
        >
          <AppIcon name="spark" size="18" />
          <span class="menu-label">AI 判定候補</span>
          <span v-if="stats?.aiPending" class="badge-count mono">{{ stats.aiPending }}</span>
        </button>

        <button
          type="button"
          class="menu-item"
          @click="$emit('open-qr-print'); $emit('close')"
        >
          <AppIcon name="printer" size="18" />
          <span class="menu-label">QR 印刷</span>
        </button>

        <button
          type="button"
          class="menu-item"
          @click="$emit('open-master'); $emit('close')"
        >
          <AppIcon name="sliders" size="18" />
          <span class="menu-label">マスタ管理</span>
        </button>

        <button
          type="button"
          class="menu-item"
          @click="$emit('open-data'); $emit('close')"
        >
          <AppIcon name="database" size="18" />
          <span class="menu-label">データ管理</span>
        </button>
      </div>

      <div class="sheet-footer">
        <ThemeSwitch />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { usePartsStats } from '../../composables/usePartsStats';
import AppIcon from '../ui/AppIcon.vue';
import ThemeSwitch from './ThemeSwitch.vue';

const emit = defineEmits([
  'close',
  'open-ai-review',
  'open-qr-print',
  'open-master',
  'open-data',
  'add'
]);

const { stats } = usePartsStats();
const sheetRef = ref(null);
const firstItemRef = ref(null);

const onKeyDown = (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    emit('close');
  }
};

onMounted(() => {
  window.addEventListener('keydown', onKeyDown);
  firstItemRef.value?.focus();
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown);
});
</script>

<style scoped>
.sheet-backdrop {
  position: fixed;
  inset: 0;
  background: var(--overlay);
  z-index: 100;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}

.sheet-container {
  background: var(--surface);
  border-top: 1px solid var(--border);
  border-radius: 16px 16px 0 0;
  padding: var(--space-3) var(--space-4) calc(var(--space-4) + env(safe-area-inset-bottom));
  box-shadow: var(--shadow-lg);
  max-height: 80dvh;
  overflow-y: auto;
}

.sheet-handle {
  width: 36px;
  height: 4px;
  background: var(--border-strong);
  border-radius: 2px;
  margin: 0 auto var(--space-3);
}

.sheet-menu {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  height: 48px;
  padding: 0 var(--space-3);
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text);
  font-family: var(--font-sans);
  font-size: var(--fs-14);
  cursor: pointer;
  text-align: left;
  transition: background-color var(--dur);
}

.menu-item:hover,
.menu-item:focus-visible {
  background: var(--surface-hover);
}

.menu-label {
  flex: 1;
}

.badge-count {
  font-size: var(--fs-11);
  padding: 2px 6px;
  border-radius: 10px;
  background: var(--accent-soft);
  color: var(--accent-text);
}

.sheet-footer {
  margin-top: var(--space-4);
  padding-top: var(--space-3);
  border-top: 1px solid var(--border);
}
</style>
