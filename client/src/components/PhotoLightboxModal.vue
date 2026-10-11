<template>
  <div class="lightbox-overlay" @click.self="emit('close')">
    <div ref="panelRef" class="lightbox-panel" role="dialog" aria-modal="true" :aria-labelledby="titleId">
      <header class="lightbox-header">
        <div class="lightbox-meta">
          <span v-if="meta.partNumber" class="lb-pn mono">{{ meta.partNumber }}</span>
          <h2 :id="titleId" class="lb-name">{{ meta.name }}</h2>
          <p class="lb-sub">
            <span class="lb-dot" :style="{ backgroundColor: part.category_id ? `var(--cat-${part.category_id % 8})` : 'var(--text-3)' }"></span>
            <span>{{ meta.category }}</span><span class="lb-sep">·</span>
            <span>{{ meta.location }}</span><span class="lb-sep">·</span>
            <span class="mono">{{ meta.qtyLabel }}</span>
          </p>
        </div>
        <button ref="closeBtnRef" type="button" class="lb-icon-btn" aria-label="閉じる" @click="emit('close')">
          <AppIcon name="x" size="20" />
        </button>
      </header>

      <div class="lightbox-stage" @click.self="emit('close')">
        <div v-if="imageState === 'loading'" class="lb-loading" aria-hidden="true"></div>
        <div v-if="imageState === 'error'" class="lb-error" role="status">
          <AppIcon name="chip" size="40" /><span>画像を読み込めませんでした</span>
        </div>
        <img v-show="imageState !== 'error'" :src="part.image_path" :alt="`${meta.name} の写真`"
             decoding="async" class="lb-img" :class="{ ready: imageState === 'loaded' }"
             @load="imageState = 'loaded'" @error="imageState = 'error'" />
      </div>

      <footer class="lightbox-footer">
        <button type="button" class="btn btn-primary lb-edit-btn" @click="onEdit">
          <AppIcon name="edit" size="16" /><span>詳細・編集</span>
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import AppIcon from './ui/AppIcon.vue';
import { useQuantitySync } from '../composables/useQuantitySync';
import { buildLightboxMeta } from '../utils/photoPreview';
import { FOCUSABLE_SELECTOR, nextTrapIndex } from '../utils/focusTrap';

const props = defineProps({ part: { type: Object, required: true } });
const emit = defineEmits(['close', 'edit']);

const qtySync = useQuantitySync();
const meta = computed(() => buildLightboxMeta(props.part, qtySync.displayOf(props.part)));
const titleId = computed(() => `lightbox-title-${props.part.id}`);
const imageState = ref('loading');
const panelRef = ref(null);
const closeBtnRef = ref(null);
let returnFocusEl = null;
let restoreFocus = true;
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

const onEdit = () => {
  restoreFocus = false;
  emit('edit', props.part);
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
  if (restoreFocus && returnFocusEl?.isConnected) {
    returnFocusEl.focus();
  }
});

watch(
  () => props.part?.image_path,
  () => {
    imageState.value = 'loading';
  }
);
</script>

<style scoped>
.lightbox-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: var(--lightbox-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  overscroll-behavior: contain;
  touch-action: manipulation;
  animation: lb-fade var(--dur) var(--ease);
}

@supports (backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)) {
  .lightbox-overlay {
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }
}

.lightbox-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  color: var(--lightbox-fg);
}

.lightbox-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  background: var(--lightbox-chrome);
  border-bottom: 1px solid var(--lightbox-border);
  padding: var(--space-3) var(--space-4);
  padding-top: calc(var(--space-3) + env(safe-area-inset-top));
}

.lightbox-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.lb-pn {
  color: var(--lightbox-fg-2);
  font-size: var(--fs-12);
}

.lb-name {
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin: 0;
  color: var(--lightbox-fg);
}

.lb-sub {
  color: var(--lightbox-fg-2);
  font-size: var(--fs-12);
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin: 0;
}

.lb-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}

.lb-sep {
  opacity: 0.6;
}

.lb-icon-btn {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--lightbox-fg);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  flex-shrink: 0;
}

.lb-icon-btn:hover {
  background: var(--lightbox-btn-hover);
}

.lb-icon-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.lightbox-stage {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4);
  position: relative;
}

.lb-loading {
  width: 120px;
  height: 120px;
  border-radius: var(--radius-md);
  background: var(--lightbox-chrome);
  animation: lb-pulse 1.2s ease-in-out infinite;
}

.lb-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  color: var(--lightbox-fg-2);
  font-size: var(--fs-13);
}

.lb-img {
  max-width: 90vw;
  max-height: 80vh;
  max-height: 80dvh;
  max-height: 100%;
  object-fit: contain;
  border-radius: var(--radius-md);
  opacity: 0;
  transform: scale(0.98);
  transition: opacity var(--dur) var(--ease), transform var(--dur) var(--ease);
}

.lb-img.ready {
  opacity: 1;
  transform: none;
}

.lightbox-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  background: var(--lightbox-chrome);
  border-top: 1px solid var(--lightbox-border);
  padding: var(--space-3) var(--space-4);
  padding-bottom: calc(var(--space-3) + env(safe-area-inset-bottom));
}

.lb-edit-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

@media (max-width: 768px) {
  .lb-edit-btn {
    width: 100%;
    justify-content: center;
    min-height: 44px;
  }

  .lb-img {
    max-width: 100%;
  }
}

@keyframes lb-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes lb-pulse {
  0%, 100% {
    opacity: 0.6;
  }
  50% {
    opacity: 0.3;
  }
}
</style>
