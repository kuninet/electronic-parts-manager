<script setup>
import { useToast } from '../composables/useToast';

const { toasts, dismiss } = useToast();

const getIcon = (type) => {
  switch (type) {
    case 'success':
      return '✅';
    case 'error':
      return '❌';
    case 'warning':
      return '⚠️';
    case 'info':
    default:
      return 'ℹ️';
  }
};
</script>

<template>
  <div class="toast-host" aria-live="polite" aria-atomic="true">
    <TransitionGroup name="toast-slide" tag="div" class="toast-container">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="toast-item"
        :class="`toast-${toast.type}`"
        role="alert"
        @click="dismiss(toast.id)"
      >
        <span class="toast-icon">{{ getIcon(toast.type) }}</span>
        <span class="toast-message">{{ toast.message }}</span>
        <button
          type="button"
          class="toast-close-btn"
          aria-label="閉じる"
          @click.stop="dismiss(toast.id)"
        >
          ×
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  bottom: 1.5rem;
  right: 1.5rem;
  z-index: 9999;
  pointer-events: none;
  max-width: 420px;
  width: 100%;
}

.toast-container {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  align-items: flex-end;
}

.toast-item {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.85rem 1.1rem;
  background: var(--bg-card-solid);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  box-shadow: var(--shadow-modal);
  font-size: 0.95rem;
  line-height: 1.4;
  cursor: pointer;
  word-break: break-word;
  transition: transform 0.2s ease, opacity 0.2s ease;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.toast-item:hover {
  transform: translateY(-2px);
}

/* タイプ別アクセント */
.toast-success {
  border-left: 4px solid var(--success);
}

.toast-error {
  border-left: 4px solid var(--danger);
}

.toast-warning {
  border-left: 4px solid var(--warning);
}

.toast-info {
  border-left: 4px solid var(--accent-color);
}

.toast-icon {
  font-size: 1.1rem;
  flex-shrink: 0;
}

.toast-message {
  flex: 1;
}

.toast-close-btn {
  background: transparent;
  color: var(--text-muted);
  font-size: 1.25rem;
  line-height: 1;
  padding: 0.2rem 0.4rem;
  border-radius: 4px;
  cursor: pointer;
  border: none;
  opacity: 0.7;
}

.toast-close-btn:hover {
  opacity: 1;
  color: var(--text-primary);
}

/* アニメーション */
.toast-slide-enter-active,
.toast-slide-leave-active {
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.toast-slide-enter-from {
  opacity: 0;
  transform: translateY(20px) scale(0.95);
}

.toast-slide-leave-to {
  opacity: 0;
  transform: translateX(30px) scale(0.9);
}

@media (max-width: 768px) {
  .toast-host {
    bottom: 1rem;
    left: 1rem;
    right: 1rem;
    max-width: none;
    width: auto;
  }

  .toast-container {
    align-items: stretch;
  }

  .toast-item {
    width: 100%;
  }
}
</style>
