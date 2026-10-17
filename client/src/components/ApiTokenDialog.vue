<script setup>
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { useApiTokenPrompt } from '../composables/useApiTokenPrompt.js';
import { setApiToken } from '../utils/apiToken.js';
import { FOCUSABLE_SELECTOR, nextTrapIndex } from '../utils/focusTrap.js';

const { state, submitApiToken, cancelApiTokenPrompt } = useApiTokenPrompt();

const tokenInput = ref('');
const showPassword = ref(false);
const dialogRef = ref(null);
const inputRef = ref(null);

const onSave = () => {
  const trimmed = tokenInput.value.trim();
  if (!trimmed) return;
  setApiToken(trimmed);
  submitApiToken(trimmed);
  tokenInput.value = '';
};

const onCancel = () => {
  cancelApiTokenPrompt();
  tokenInput.value = '';
};

const onKeyDown = (e) => {
  if (!state.open) return;
  if (e.isComposing) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    onCancel();
    return;
  }

  if (e.key === 'Tab') {
    if (!dialogRef.value) return;
    const focusable = Array.from(dialogRef.value.querySelectorAll(FOCUSABLE_SELECTOR));
    if (focusable.length === 0) return;
    e.preventDefault();
    const currentIndex = focusable.indexOf(document.activeElement);
    const nextIdx = nextTrapIndex(currentIndex, focusable.length, e.shiftKey);
    if (nextIdx >= 0 && focusable[nextIdx]) {
      focusable[nextIdx].focus();
    }
  }
};

watch(() => state.open, (open) => {
  if (open) {
    tokenInput.value = '';
    showPassword.value = false;
    nextTick(() => {
      inputRef.value?.focus();
    });
  }
});

onMounted(() => {
  window.addEventListener('keydown', onKeyDown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown);
});
</script>

<template>
  <div v-if="state.open" class="token-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="token-dialog-title">
    <div ref="dialogRef" class="token-dialog-card">
      <h3 id="token-dialog-title" class="token-dialog-title">API トークンを入力してください</h3>
      <p class="token-dialog-desc">
        サーバーの環境変数 <code>EPM_API_TOKEN</code> に設定された値を入力してください。入力されたトークンはブラウザに保存され、以後の通信で自動的に送信されます。
      </p>

      <div v-if="state.errorMessage" class="token-dialog-error" role="alert">
        {{ state.errorMessage }}
      </div>

      <div class="token-input-group">
        <input
          ref="inputRef"
          v-model="tokenInput"
          :type="showPassword ? 'text' : 'password'"
          class="token-input"
          placeholder="API トークン"
          autocomplete="off"
          spellcheck="false"
          @keydown.enter.prevent="onSave"
        />
        <button
          type="button"
          class="btn btn-ghost token-toggle-btn"
          :title="showPassword ? 'トークンを隠す' : 'トークンを表示'"
          @click="showPassword = !showPassword"
        >
          {{ showPassword ? '非表示' : '表示' }}
        </button>
      </div>

      <div class="token-dialog-actions">
        <button type="button" class="btn btn-outline" @click="onCancel">
          キャンセル
        </button>
        <button
          type="button"
          class="btn btn-primary"
          :disabled="!tokenInput.trim()"
          @click="onSave"
        >
          保存
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.token-dialog-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 10000;
  padding: var(--space-4);
}

.token-dialog-card {
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--space-6);
  width: 100%;
  max-width: 440px;
  box-shadow: var(--shadow-lg);
  position: relative;
}

.token-dialog-title {
  margin: 0 0 var(--space-2) 0;
  font-size: var(--fs-16);
  font-weight: 600;
  color: var(--text);
}

.token-dialog-desc {
  margin: 0 0 var(--space-4) 0;
  font-size: var(--fs-13);
  color: var(--text-2);
  line-height: 1.5;
}

.token-dialog-desc code {
  font-family: var(--font-mono);
  background: var(--surface-2);
  padding: 2px 4px;
  border-radius: var(--radius-sm);
  font-size: var(--fs-12);
}

.token-dialog-error {
  margin-bottom: var(--space-3);
  padding: var(--space-2) var(--space-3);
  background: var(--ng-bg);
  border: 1px solid var(--ng);
  color: var(--ng-fg);
  border-radius: var(--radius-md);
  font-size: var(--fs-13);
}

.token-input-group {
  display: flex;
  gap: var(--space-2);
  margin-bottom: var(--space-5);
}

.token-input {
  flex: 1;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-3);
  color: var(--text);
  font-size: var(--fs-14);
  font-family: var(--font-mono);
  outline: none;
  transition: border-color var(--dur);
}

.token-input:focus {
  border-color: var(--accent);
}

.token-toggle-btn {
  font-size: var(--fs-12);
  padding: var(--space-2) var(--space-3);
}

.token-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>
