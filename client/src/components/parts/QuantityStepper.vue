<template>
  <div
    class="quantity-stepper"
    :class="size"
    role="group"
    :aria-label="`${part.part_number || part.name} の数量`"
    @click.stop
  >
    <button
      type="button"
      class="step-btn minus"
      :disabled="qty <= 0"
      aria-label="1 減らす"
      @click="handleStep(-1)"
    >
      <AppIcon name="minus" size="12" />
    </button>

    <div class="val-container">
      <input
        v-if="isEditing"
        ref="inputRef"
        v-model="editValue"
        type="number"
        min="0"
        inputmode="numeric"
        class="val-input mono"
        @blur="commitEdit"
        @keydown="handleKeyDown"
      />
      <button
        v-else
        type="button"
        class="val-btn mono"
        :aria-label="`数量 ${qty}。クリックで直接入力`"
        @click="startEdit"
      >
        {{ qty }}
      </button>
    </div>

    <button
      type="button"
      class="step-btn plus"
      aria-label="1 増やす"
      @click="handleStep(1)"
    >
      <AppIcon name="plus" size="12" />
    </button>
  </div>
</template>

<script setup>
import { ref, computed, nextTick } from 'vue';
import { useQuantitySync } from '../../composables/useQuantitySync';
import AppIcon from '../ui/AppIcon.vue';

const props = defineProps({
  part: {
    type: Object,
    required: true
  },
  size: {
    type: String,
    default: 'sm',
    validator: (v) => ['sm', 'md'].includes(v)
  }
});

const qtySync = useQuantitySync();
const isEditing = ref(false);
const editValue = ref(0);
const inputRef = ref(null);

const qty = computed(() => {
  return qtySync.displayOf(props.part);
});

const handleStep = (delta) => {
  qtySync.step(props.part, delta);
};

const startEdit = () => {
  editValue.value = qty.value;
  isEditing.value = true;
  nextTick(() => {
    inputRef.value?.focus();
    inputRef.value?.select();
  });
};

const commitEdit = () => {
  if (!isEditing.value) return;
  isEditing.value = false;
  qtySync.set(props.part, editValue.value);
};

const cancelEdit = () => {
  isEditing.value = false;
};

const handleKeyDown = (e) => {
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    commitEdit();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    cancelEdit();
  }
};
</script>

<style scoped>
.quantity-stepper {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  overflow: hidden;
}

.step-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
  padding: 0;
  transition: background-color var(--dur), color var(--dur);
}

.step-btn:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--text);
}

.step-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.val-container {
  display: flex;
  align-items: center;
  justify-content: center;
}

.val-btn {
  border: none;
  background: transparent;
  color: var(--text);
  font-weight: 500;
  cursor: pointer;
  padding: 0 var(--space-1);
  text-align: center;
}

.val-btn:hover {
  background: var(--surface-hover);
}

.val-input {
  border: none;
  background: var(--surface-2);
  color: var(--text);
  font-weight: 500;
  text-align: center;
  outline: none;
  padding: 0;
  appearance: textfield;
  -moz-appearance: textfield;
}

.val-input::-webkit-outer-spin-button,
.val-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

/* sm サイズ: 28×26px のボタン */
.quantity-stepper.sm .step-btn {
  width: 26px;
  height: 28px;
}

.quantity-stepper.sm .val-btn,
.quantity-stepper.sm .val-input {
  min-width: 32px;
  height: 28px;
  font-size: var(--fs-12);
}

/* md サイズ: 36×44px のボタン（モバイル用） */
.quantity-stepper.md .step-btn {
  width: 36px;
  height: 44px;
}

.quantity-stepper.md .val-btn,
.quantity-stepper.md .val-input {
  min-width: 44px;
  height: 44px;
  font-size: var(--fs-14);
}
</style>
