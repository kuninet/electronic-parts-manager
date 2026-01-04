<script setup>
import { ref, onMounted } from 'vue';

import api from '../api';
import TagInput from './TagInput.vue';

const props = defineProps({
  part: {
    type: Object,
    default: null
  }
});

const emit = defineEmits(['close', 'saved']);

const formData = ref({
  name: '',
  description: '',
  category_id: '',
  location_id: '',
  quantity: 0,
  datasheet_url: '',
  tags: []
});

const categories = ref([]);
const locations = ref([]);
const imageFile = ref(null);
const datasheetFile = ref(null);
const loading = ref(false);

const suggestedTags = ref([]);

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

    if (props.part) {
      formData.value = { ...props.part };
      if (typeof formData.value.tags === 'string') {
          formData.value.tags = formData.value.tags.split(',').filter(t => t);
      } else if (!formData.value.tags) {
          formData.value.tags = [];
      }
    }
  } catch (err) {
    console.error('Failed to load metadata', err);
  }
});

const handleImageChange = (e) => {
  imageFile.value = e.target.files[0];
};

const handleDatasheetChange = (e) => {
  datasheetFile.value = e.target.files[0];
};



const handleSubmit = async () => {
  loading.value = true;
  try {
    const data = new FormData();
    
    // Auto-generate name if empty
    if (!formData.value.name || formData.value.name.trim() === '') {
        const now = new Date();
        const timestamp = now.toLocaleString('ja-JP', { 
            year: 'numeric', 
            month: '2-digit', 
            day: '2-digit', 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        formData.value.name = `(名称未設定) ${timestamp}`;
    }

    Object.keys(formData.value).forEach(key => {
        if (key === 'tags') {
            data.append('tags', formData.value.tags.join(','));
        } else if (formData.value[key] !== null && formData.value[key] !== undefined) {
             data.append(key, formData.value[key]);
        }
    });

    if (imageFile.value) data.append('image', imageFile.value);
    if (datasheetFile.value) data.append('datasheet', datasheetFile.value);

    if (props.part) {
      await api.put(`/parts/${props.part.id}`, data);
    } else {
      await api.post('/parts', data);
    }
    
    emit('saved');
    emit('close');
  } catch (err) {
    console.error('Failed to save part', err);
    alert('Failed to save part');
  } finally {
    loading.value = false;
  }
};
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-content glass-panel">
      <div v-if="formData.image_path" class="cover-image" :style="{ backgroundImage: `url(${formData.image_path})` }"></div>
      
      <div class="modal-body">
        <div class="modal-header-actions">
            <h2>{{ part ? 'パーツ編集' : '新規パーツ追加' }}</h2>
             <div class="form-actions-top">
                <button type="button" class="btn btn-sm" @click="$emit('close')">キャンセル</button>
                <button type="button" class="btn btn-primary btn-sm" @click="handleSubmit" :disabled="loading">
                  {{ loading ? '保存中...' : '保存' }}
                </button>
              </div>
        </div>
        
        <form @submit.prevent="handleSubmit" class="part-form">
          <div class="form-group">
            <label>パーツ名</label>
            <input v-model="formData.name" placeholder="未入力で自動生成" />
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>カテゴリ</label>
              <select v-model="formData.category_id">
                <option value="">カテゴリを選択</option>
                <option v-for="cat in categories" :key="cat.id" :value="cat.id">
                  {{ cat.name }}
                </option>
              </select>
            </div>

            <div class="form-group">
              <label>保管場所</label>
              <select v-model="formData.location_id">
                <option value="">保管場所を選択</option>
                <option v-for="loc in locations" :key="loc.id" :value="loc.id">
                  {{ loc.name }}
                </option>
              </select>
            </div>
          </div>

          <div class="form-group">
            <label>個数</label>
            <input type="number" v-model="formData.quantity" min="0" />
          </div>

          <div class="form-group">
            <label>説明</label>
            <textarea v-model="formData.description" rows="3" placeholder="簡単な説明を入力..."></textarea>
          </div>

          <div class="form-group">
            <label>画像</label>
            <input type="file" accept="image/*" @change="handleImageChange" />
            <!-- Preview kept for new uploads or if no cover image shows (though cover image logic covers this) -->
            <!-- We can keep it or remove it. Let's keep it but maybe hide if same as cover? -->
            <!-- For now, keep as is for simplicity, user can see what file is selected -->
             <div v-if="imageFile" class="current-image-preview">
                 <p>新規選択画像: {{ imageFile.name }}</p>
             </div>
          </div>

          <div class="form-group">
            <label>データシート (PDF)</label>
            <div v-if="formData.datasheet_path" class="current-file">
              <a :href="formData.datasheet_path" target="_blank" class="file-link">
                📄 現在のPDFを確認
              </a>
            </div>
            <input type="file" accept="application/pdf" @change="handleDatasheetChange" />
          </div>

          <div class="form-group">
            <label>タグ</label>
            <TagInput v-model="formData.tags" :suggestions="suggestedTags" />
          </div>

          <div class="form-group">
            <label>データシート等 URL</label>
            <input v-model="formData.datasheet_url" placeholder="https://..." />
          </div>

          <div class="form-actions">
            <button type="button" class="btn" @click="$emit('close')">キャンセル</button>
            <button type="submit" class="btn btn-primary" :disabled="loading">
              {{ loading ? '保存中...' : '保存' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
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
  padding: 0; /* Changed from 2rem to 0 for cover image */
  background: #1e293b; /* Fallback */
  background: rgba(30, 41, 59, 0.95);
  border-radius: 12px; /* Ensure rounded corners */
}

.modal-body {
    padding: 2rem;
}

.cover-image {
    width: 100%;
    height: 200px;
    background-size: cover;
    background-position: center;
    border-radius: 12px 12px 0 0; /* Top rounded corners */
    position: relative;
}

.cover-image::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    height: 60px;
    background: linear-gradient(to bottom, transparent, rgba(30, 41, 59, 0.95)); /* Seamless blend */
}

h2 {
  margin-bottom: 0; /* Changed from 1.5rem */
  color: var(--accent-color);
  font-size: 1.25rem;
}

.modal-header-actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--border-color);
}

.form-actions-top {
    display: flex;
    gap: 0.5rem;
}

.btn-sm {
    padding: 0.4rem 0.8rem;
    font-size: 0.9rem;
}

.part-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-row {
  display: flex;
  gap: 1rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  flex: 1;
}

label {
  font-size: 0.9rem;
  color: var(--text-secondary);
}

input, select, textarea {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border-color);
  padding: 0.75rem;
  border-radius: 8px;
  color: white;
  font-family: inherit;
}

input:focus, select:focus, textarea:focus {
  outline: none;
  border-color: var(--accent-color);
}

/* Fix for dropdown options visibility */
select option {
    background-color: #1e293b;
    color: white;
}


.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 1rem;
  margin-top: 1rem;
}

.current-file {
  margin-bottom: 0.5rem;
  font-size: 0.9rem;
}

.file-link {
  color: var(--accent-color);
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.file-link:hover {
  text-decoration: underline;
}

.current-image-preview {
  margin-top: 0.5rem;
}

.current-image-preview p {
  font-size: 0.9rem;
  color: var(--text-secondary);
  margin-bottom: 0.5rem;
}

.current-image-preview img {
  max-width: 100%;
  max-height: 200px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
}
.current-image-preview img {
  max-width: 100%;
  max-height: 200px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
}
</style>
