<template>
  <div class="toast-host">
    <!-- ステータス通知リージョン（polite） -->
    <div class="toast-region" role="status" aria-live="polite">
      <TransitionGroup name="toast">
        <div
          v-for="toast in politeToasts"
          :key="toast.id"
          class="toast-item"
          :class="`toast-${toast.type}`"
          @mouseenter="pause(toast.id)"
          @mouseleave="resume(toast.id)"
          @focusin="pause(toast.id)"
          @focusout="resume(toast.id)"
        >
          <div class="toast-icon-wrap" :class="toast.type" aria-hidden="true">
            <AppIcon :name="getIconName(toast.type)" size="16" />
          </div>
          <span class="toast-message">{{ toast.message }}</span>
          <button
            type="button"
            class="toast-close-btn"
            aria-label="通知を閉じる"
            @click="dismiss(toast.id)"
          >
            <AppIcon name="x" size="12" />
          </button>
        </div>
      </TransitionGroup>
    </div>

    <!-- アラート通知リージョン（assertive） -->
    <div class="toast-region" role="alert" aria-live="assertive">
      <TransitionGroup name="toast">
        <div
          v-for="toast in alertToasts"
          :key="toast.id"
          class="toast-item"
          :class="`toast-${toast.type}`"
          @mouseenter="pause(toast.id)"
          @mouseleave="resume(toast.id)"
          @focusin="pause(toast.id)"
          @focusout="resume(toast.id)"
        >
          <div class="toast-icon-wrap" :class="toast.type" aria-hidden="true">
            <AppIcon :name="getIconName(toast.type)" size="16" />
          </div>
          <span class="toast-message">{{ toast.message }}</span>
          <button
            type="button"
            class="toast-close-btn"
            aria-label="通知を閉じる"
            @click="dismiss(toast.id)"
          >
            <AppIcon name="x" size="12" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useToast } from '../composables/useToast';
import AppIcon from './ui/AppIcon.vue';

const { toasts, dismiss, pause, resume } = useToast();

const politeToasts = computed(() => {
  return toasts.value.filter((t) => t.type === 'success' || t.type === 'info');
});

const alertToasts = computed(() => {
  return toasts.value.filter((t) => t.type === 'warning' || t.type === 'error');
});

const getIconName = (type) => {
  switch (type) {
    case 'success':
      return 'check';
    case 'warning':
    case 'error':
      return 'alert';
    case 'info':
    default:
      return 'info';
  }
};
</script>

<style scoped>
.toast-host {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 9999;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-width: 380px;
  width: 100%;
}

.toast-region {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.toast-item {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 10px var(--space-3);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  word-break: break-word;
}

.toast-icon-wrap {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.toast-icon-wrap.success {
  color: var(--ok);
}

.toast-icon-wrap.info {
  color: var(--accent);
}

.toast-icon-wrap.warning {
  color: var(--warn);
}

.toast-icon-wrap.error {
  color: var(--ng);
}

.toast-message {
  flex: 1;
  font-family: var(--font-sans);
  font-size: var(--fs-13);
  color: var(--text);
  line-height: 1.4;
}

.toast-close-btn {
  background: transparent;
  border: none;
  color: var(--text-3);
  cursor: pointer;
  padding: var(--space-1);
  border-radius: var(--radius-sm);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: color var(--dur);
}

.toast-close-btn:hover {
  color: var(--text);
}

/* アニメーション */
.toast-enter-active {
  transition: opacity 160ms var(--ease), transform 160ms var(--ease);
}

.toast-leave-active {
  transition: opacity 120ms var(--ease);
}

.toast-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.toast-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .toast-enter-active,
  .toast-leave-active {
    transition-duration: 0ms !important;
  }
}

/* モバイル対応 */
@media (max-width: 768px) {
  .toast-host {
    left: 12px;
    right: 12px;
    bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom) + 12px);
    max-width: none;
    width: auto;
  }
}
</style>
