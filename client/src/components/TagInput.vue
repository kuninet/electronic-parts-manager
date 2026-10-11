<script setup>
import { ref } from 'vue';

const props = defineProps({
  modelValue: {
    type: Array,
    default: () => []
  },
  suggestions: {
    type: Array,
    default: () => []
  }
});

const emit = defineEmits(['update:modelValue']);

const newTag = ref('');

const addTag = () => {
    const val = newTag.value.trim();
    if (val && !props.modelValue.includes(val)) {
        const updatedTags = [...props.modelValue, val];
        emit('update:modelValue', updatedTags);
    }
    newTag.value = '';
};

const removeTag = (index) => {
    const updatedTags = [...props.modelValue];
    updatedTags.splice(index, 1);
    emit('update:modelValue', updatedTags);
};
</script>

<template>
  <div class="tag-input-wrapper">
    <div class="tag-input-container">
      <input 
        v-model="newTag" 
        @keydown.enter.prevent="addTag" 
        placeholder="タグを入力..." 
        list="tag-suggestions"
        class="tag-input-field"
      />
      <datalist id="tag-suggestions">
        <option v-for="tag in suggestions" :key="tag.id" :value="tag.name" />
      </datalist>
      <button type="button" class="btn btn-small" @click.stop="addTag">追加</button>
    </div>
    <div class="tags-list">
      <span v-for="(tag, index) in modelValue" :key="index" class="tag-pill">
        {{ tag }}
        <button type="button" class="remove-tag" @click.stop="removeTag(index)">×</button>
      </span>
    </div>
  </div>
</template>

<style scoped>
.tag-input-wrapper {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.tag-input-container {
  display: flex;
  gap: var(--space-2);
}

.tag-input-field {
  flex: 1;
  background: var(--surface);
  border: 1px solid var(--border);
  padding: 0 var(--space-2);
  height: 32px;
  border-radius: var(--radius-md);
  color: var(--text);
  font-family: var(--font-sans);
  font-size: var(--fs-13);
  min-width: 100px;
}

.tag-input-field:focus {
  outline: none;
  border-color: var(--accent);
}

.tags-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

.tag-pill {
  background: var(--accent-soft);
  color: var(--accent-text);
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  font-size: var(--fs-12);
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}

.remove-tag {
  background: none;
  border: none;
  color: var(--accent-text);
  font-size: var(--fs-12);
  cursor: pointer;
  padding: 0;
  line-height: 1;
  opacity: 0.7;
}

.remove-tag:hover {
  opacity: 1;
  color: var(--ng);
}

.btn-small {
  padding: 0 var(--space-3);
  height: 32px;
  font-size: var(--fs-13);
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background-color var(--dur);
}

.btn-small:hover {
  background: var(--surface-hover);
}
</style>
