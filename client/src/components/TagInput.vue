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
  gap: 0.5rem;
}

.tag-input-container {
  display: flex;
  gap: 0.5rem;
}

.tag-input-field {
    flex: 1;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--border-color);
    padding: 0.5rem;
    border-radius: 4px;
    color: white;
    min-width: 100px;
}

.tags-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.tag-pill {
  background: var(--accent-color);
  color: white;
  padding: 0.1rem 0.5rem;
  border-radius: 1rem;
  font-size: 0.85rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.remove-tag {
  background: none;
  border: none;
  color: white;
  font-size: 1.1rem;
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.remove-tag:hover {
  color: #ffcccc;
}

.btn-small {
  padding: 0.4rem 0.8rem;
  font-size: 0.9rem;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid var(--border-color);
  color: white;
  border-radius: 4px;
  cursor: pointer;
}

.btn-small:hover {
    background: rgba(255, 255, 255, 0.2);
}
</style>
