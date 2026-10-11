<template>
  <div class="theme-switch" role="group" aria-label="テーマ">
    <button
      type="button"
      class="theme-btn"
      :class="{ active: theme === THEMES.LIGHT }"
      :aria-pressed="theme === THEMES.LIGHT"
      aria-label="ライトテーマ"
      @click="setTheme(THEMES.LIGHT)"
    >
      <AppIcon name="sun" size="14" />
      <span>ライト</span>
    </button>
    <button
      type="button"
      class="theme-btn"
      :class="{ active: theme === THEMES.DARK }"
      :aria-pressed="theme === THEMES.DARK"
      aria-label="ダークテーマ"
      @click="setTheme(THEMES.DARK)"
    >
      <AppIcon name="moon" size="14" />
      <span>ダーク</span>
    </button>
    <button
      type="button"
      class="theme-btn"
      :class="{ active: theme === THEMES.SYSTEM }"
      :aria-pressed="theme === THEMES.SYSTEM"
      aria-label="自動テーマ（端末設定に同期）"
      @click="setTheme(THEMES.SYSTEM)"
    >
      <AppIcon name="monitor" size="14" />
      <span>自動</span>
    </button>
  </div>
</template>

<script setup>
import { useTheme } from '../../composables/useTheme';
import AppIcon from '../ui/AppIcon.vue';

const { theme, setTheme, THEMES } = useTheme();
</script>

<style scoped>
.theme-switch {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: 3px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.theme-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  height: 26px;
  padding: 0 var(--space-1);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-2);
  font-family: var(--font-sans);
  font-size: var(--fs-11);
  cursor: pointer;
  transition: background-color var(--dur), color var(--dur);
}

.theme-btn:hover {
  color: var(--text);
}

.theme-btn.active {
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow-sm);
  font-weight: 500;
}
</style>
