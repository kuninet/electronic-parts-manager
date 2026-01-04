<script setup>
import { ref, onMounted } from 'vue';
import api from '../api';
import TagInput from './TagInput.vue';

const props = defineProps({
  selectedCount: {
    type: Number,
    required: true
  }
});

const emit = defineEmits(['close', 'save']);

const categories = ref([]);
const locations = ref([]);
const suggestedTags = ref([]);

const categoryAction = ref('no_change'); // 'no_change', 'set', 'unset'
const selectedCategoryId = ref('');

const locationAction = ref('no_change'); // 'no_change', 'set', 'unset'
const selectedLocationId = ref('');

const addTags = ref([]);
const removeTags = ref([]);

onMounted(async () => {
    try {
        const [catsRes, locsRes, tagsRes] = await Promise.all([
             api.get('/categories'),
             api.get('/locations'),
             api.get('/tags')
        ]);
        categories.value = catsRes.data;
        locations.value = locsRes.data;
        suggestedTags.value = tagsRes.data;
    } catch (err) {
        console.error(err);
    }
});

const handleSave = () => {
    const updates = {};

    // Category
    if (categoryAction.value === 'set') {
        updates.category_id = selectedCategoryId.value;
    } else if (categoryAction.value === 'unset') {
        updates.category_id = null;
    }

    // Location
    if (locationAction.value === 'set') {
        updates.location_id = selectedLocationId.value;
    } else if (locationAction.value === 'unset') {
        updates.location_id = null;
    }

    // Tags
    if (addTags.value.length > 0) {
        updates.add_tags = addTags.value;
    }
    if (removeTags.value.length > 0) {
        updates.remove_tags = removeTags.value;
    }

    emit('save', updates);
};
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-content glass-panel">
        <div class="modal-header">
            <h2>一括編集 ({{ selectedCount }}個のアイテム)</h2>
            <button class="btn-icon" @click="$emit('close')">❌</button>
        </div>

        <div class="modal-body">
            <!-- Category -->
            <div class="form-group">
                <label>カテゴリ</label>
                <div class="radio-group">
                    <label><input type="radio" v-model="categoryAction" value="no_change"> 変更しない</label>
                    <label><input type="radio" v-model="categoryAction" value="unset"> 解除する（未分類）</label>
                    <label><input type="radio" v-model="categoryAction" value="set"> 変更する</label>
                </div>
                <select v-if="categoryAction === 'set'" v-model="selectedCategoryId" class="mt-2">
                    <option value="" disabled>カテゴリを選択してください</option>
                    <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
                </select>
            </div>

            <!-- Location -->
            <div class="form-group">
                <label>保管場所</label>
                 <div class="radio-group">
                    <label><input type="radio" v-model="locationAction" value="no_change"> 変更しない</label>
                    <label><input type="radio" v-model="locationAction" value="unset"> 解除する（未設定）</label>
                    <label><input type="radio" v-model="locationAction" value="set"> 変更する</label>
                </div>
                <select v-if="locationAction === 'set'" v-model="selectedLocationId" class="mt-2">
                    <option value="" disabled>保管場所を選択してください</option>
                    <option v-for="loc in locations" :key="loc.id" :value="loc.id">{{ loc.name }}</option>
                </select>
            </div>

            <!-- Tags -->
            <div class="form-group">
                <label>タグを追加</label>
                <div class="tag-desc">選択したアイテムに以下のタグを追加します（既存のタグは維持されます）</div>
                <TagInput v-model="addTags" :suggestions="suggestedTags" />
            </div>

            <div class="form-group">
                <label>タグを削除</label>
                 <div class="tag-desc">選択したアイテムから以下のタグを削除します</div>
                <TagInput v-model="removeTags" :suggestions="suggestedTags" />
            </div>

            <div class="form-actions">
                <button class="btn" @click="$emit('close')">キャンセル</button>
                <button class="btn btn-primary" @click="handleSave">変更を適用</button>
            </div>
        </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 1rem;
}

.modal-content {
  width: 100%;
  max-width: 600px;
  max-height: 90vh;
  overflow-y: auto;
  background: #1e293b;
  padding: 2rem;
  border-radius: 12px;
}

.modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
    border-bottom: 1px solid var(--border-color);
    padding-bottom: 1rem;
}

h2 {
    margin: 0;
    font-size: 1.5rem;
    color: var(--text-primary);
}

.form-group {
    margin-bottom: 2rem;
}

label {
    display: block;
    margin-bottom: 0.5rem;
    color: var(--text-secondary);
    font-weight: bold;
}

.radio-group {
    display: flex;
    gap: 1.5rem;
    margin-bottom: 0.5rem;
}

.radio-group label {
    font-weight: normal;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.3rem;
    color: white;
}

select {
    width: 100%;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--border-color);
    padding: 0.75rem;
    border-radius: 8px;
    color: white;
}

select option {
    background: #1e293b;
}

.mt-2 {
    margin-top: 0.5rem;
}

.tag-desc {
    font-size: 0.85rem;
    color: var(--text-secondary);
    margin-bottom: 0.5rem;
}

.form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 1rem;
    margin-top: 2rem;
}
</style>
