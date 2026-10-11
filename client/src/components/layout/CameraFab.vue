<template>
  <button
    type="button"
    class="camera-fab"
    :disabled="uploading"
    :aria-label="uploading ? '登録中' : 'カメラでパーツ追加'"
    @click="$emit('click')"
  >
    <div v-if="uploading" class="spinner" aria-hidden="true"></div>
    <AppIcon v-else name="camera" size="22" />
  </button>
</template>

<script setup>
import AppIcon from '../ui/AppIcon.vue';

defineProps({
  uploading: {
    type: Boolean,
    default: false
  }
});

defineEmits(['click']);
</script>

<style scoped>
.camera-fab {
  position: fixed;
  right: 16px;
  bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom) + 16px);
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: var(--accent);
  color: var(--on-accent);
  box-shadow: var(--shadow-md);
  z-index: 51;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform var(--dur-fast), background-color var(--dur);
}

.camera-fab:active:not(:disabled) {
  transform: scale(0.95);
}

.camera-fab:disabled {
  opacity: 0.8;
  cursor: wait;
}

.spinner {
  width: 24px;
  height: 24px;
  border: 3px solid var(--accent-soft);
  border-top-color: var(--on-accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation: none;
  }
}
</style>
