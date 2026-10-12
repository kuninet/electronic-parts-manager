<template>
  <div class="zoom-overlay" @click.self="emit('close')">
    <div
      ref="panelRef"
      class="zoom-panel"
      role="dialog"
      aria-modal="true"
      :aria-label="caption || alt || '拡大画像'"
    >
      <header class="zoom-header">
        <div class="zoom-title-area">
          <span v-if="caption" class="zoom-caption">{{ caption }}</span>
        </div>
        <button
          ref="closeBtnRef"
          type="button"
          class="zoom-close-btn"
          aria-label="閉じる"
          @click="emit('close')"
        >
          <AppIcon name="x" size="20" />
        </button>
      </header>

      <div class="zoom-stage" @click.self="emit('close')">
        <div v-if="imageState === 'loading'" class="zoom-loading" aria-hidden="true"></div>
        <div v-if="imageState === 'error'" class="zoom-error" role="status">
          <AppIcon name="chip" size="40" />
          <span>画像を読み込めませんでした</span>
        </div>
        <img
          v-show="imageState !== 'error'"
          :src="src"
          :alt="alt || caption || '部品写真'"
          decoding="async"
          class="zoom-img"
          :class="{ ready: imageState === 'loaded' }"
          @load="imageState = 'loaded'"
          @error="imageState = 'error'"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue';
import AppIcon from './ui/AppIcon.vue';
import { FOCUSABLE_SELECTOR, nextTrapIndex } from '../utils/focusTrap.js';

const props = defineProps({
  src: {
    type: String,
    required: true
  },
  alt: {
    type: String,
    default: ''
  },
  caption: {
    type: String,
    default: ''
  }
});

const emit = defineEmits(['close']);

const imageState = ref('loading');
const panelRef = ref(null);
const closeBtnRef = ref(null);
let returnFocusEl = null;
let prevOverflow = '';

const onKeyDown = (e) => {
  if (e.isComposing) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    emit('close');
    return;
  }
  if (e.key === 'Tab') {
    if (!panelRef.value) return;
    const focusable = Array.from(panelRef.value.querySelectorAll(FOCUSABLE_SELECTOR));
    if (focusable.length === 0) return;
    e.preventDefault();
    const currentIndex = focusable.indexOf(document.activeElement);
    const nextIdx = nextTrapIndex(currentIndex, focusable.length, e.shiftKey);
    if (nextIdx >= 0 && focusable[nextIdx]) {
      focusable[nextIdx].focus();
    }
  }
};

onMounted(async () => {
  returnFocusEl = document.activeElement;
  prevOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = 'hidden';
  window.addEventListener('keydown', onKeyDown);
  await nextTick();
  closeBtnRef.value?.focus();
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown);
  document.documentElement.style.overflow = prevOverflow;
  if (returnFocusEl?.isConnected) {
    returnFocusEl.focus();
  }
});

watch(
  () => props.src,
  () => {
    imageState.value = 'loading';
  }
);
</script>

<style scoped>
.zoom-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: var(--lightbox-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  overscroll-behavior: contain;
  touch-action: manipulation;
  padding: var(--space-4);
  animation: zoom-fade var(--dur) var(--ease);
}

.zoom-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 90vw;
  max-height: 90vh;
  outline: none;
}

.zoom-header {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) var(--space-3);
  background: var(--lightbox-chrome);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  z-index: 1;
}

.zoom-title-area {
  flex: 1;
  min-width: 0;
  margin-right: var(--space-2);
}

.zoom-caption {
  font-size: var(--fs-13);
  color: var(--lightbox-fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: block;
}

.zoom-close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  background: transparent;
  border: 1px solid var(--lightbox-border);
  border-radius: var(--radius-md);
  color: var(--lightbox-fg);
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease);
}

.zoom-close-btn:hover {
  background: var(--lightbox-btn-hover);
}

.zoom-close-btn:focus-visible {
  outline: 2px solid var(--lightbox-fg);
  outline-offset: 2px;
}

.zoom-stage {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 200px;
  max-height: 90vh;
  padding-top: 48px;
}

.zoom-img {
  max-width: 100%;
  max-height: calc(90vh - 48px);
  object-fit: contain;
  border-radius: var(--radius-md);
  opacity: 0;
  transition: opacity var(--dur) var(--ease);
}

.zoom-img.ready {
  opacity: 1;
}

.zoom-loading {
  width: 32px;
  height: 32px;
  border: 2px solid var(--lightbox-border);
  border-top-color: var(--lightbox-fg-2);
  border-radius: 9999px;
  animation: zoom-spin 0.8s linear infinite;
}

.zoom-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  color: var(--lightbox-fg-2);
  font-size: var(--fs-13);
}

@keyframes zoom-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes zoom-spin {
  to { transform: rotate(360deg); }
}
</style>
