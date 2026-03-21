<script setup>
import { ref, onMounted } from 'vue';

import api from '../api';
import TagInput from './TagInput.vue';
import MiniQrScanner from './MiniQrScanner.vue';

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
  used_at: '',
  used_for: '',
  used_note: '',
  datasheet_url: '',
  qr_code: '',
  tags: []
});

const categories = ref([]);
const locations = ref([]);
const imageFile = ref(null);
const datasheetFile = ref(null);
const loading = ref(false);
const showQrScanner = ref(false);
const isUsed = ref(false);

const suggestedTags = ref([]);

const formatUsedAtForDisplay = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ja-JP');
};

const createCurrentTimestamp = () => {
  return new Date().toISOString();
};

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
      isUsed.value = !!props.part.used_at;
      if (typeof formData.value.tags === 'string') {
          formData.value.tags = formData.value.tags.split(',').filter(t => t);
      } else if (!formData.value.tags) {
          formData.value.tags = [];
      }
      formData.value.used_at = props.part.used_at || '';
      formData.value.used_for = props.part.used_for || '';
      formData.value.used_note = props.part.used_note || '';
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
    if (props.part && isUsed.value && (!formData.value.used_for || !formData.value.used_for.trim())) {
      alert('使用先を入力してください');
      return;
    }

    const wasUsed = !!props.part?.used_at;
    if (props.part && !wasUsed && isUsed.value) {
      const confirmed = confirm('この部品を使用済みにします。通常一覧から外れ、保管場所はクリアされます。よろしいですか？');
      if (!confirmed) return;
    }

    if (props.part && wasUsed && !isUsed.value) {
      const confirmed = confirm('この部品を通常在庫に戻します。使用日時・使用先・使用メモはクリアされます。よろしいですか？');
      if (!confirmed) return;
    }

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
            const tagsVal = Array.isArray(formData.value.tags) 
                ? formData.value.tags.join(',') 
                : (formData.value.tags || '');
            data.append('tags', tagsVal);
        } else if (key === 'used_at' || key === 'used_for' || key === 'used_note') {
            // handled below
        } else if (formData.value[key] !== null && formData.value[key] !== undefined) {
             data.append(key, formData.value[key]);
        }
    });

    if (props.part) {
      const nextUsedAt = isUsed.value
        ? (formData.value.used_at || props.part.used_at || createCurrentTimestamp())
        : '';
      data.append('used_at', nextUsedAt);
      data.append('used_for', isUsed.value ? (formData.value.used_for || '') : '');
      data.append('used_note', isUsed.value ? (formData.value.used_note || '') : '');
    }

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
    if (err.response && err.response.data && err.response.data.error) {
        alert('保存に失敗しました: ' + err.response.data.error);
    } else {
        alert('保存に失敗しました');
    }
  } finally {
    loading.value = false;
  }
};

const toggleUsedState = (nextValue) => {
  isUsed.value = nextValue;
  if (nextValue) {
    formData.value.location_id = '';
    if (!formData.value.used_at) {
      formData.value.used_at = props.part?.used_at || createCurrentTimestamp();
    }
    return;
  }

  formData.value.used_at = '';
  formData.value.used_for = '';
  formData.value.used_note = '';
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
            <label>🏷️ QRコード</label>
            <div class="qr-input-row">
              <input v-model="formData.qr_code" placeholder="QRコードID（任意）" />
              <button type="button" class="btn btn-sm btn-scan" @click="showQrScanner = true">📷</button>
            </div>
            <small style="color: var(--text-secondary); font-size: 0.8rem;">スキャンまたは手動入力</small>
          </div>

          <MiniQrScanner
            v-if="showQrScanner"
            @scanned="(code) => { formData.qr_code = code; showQrScanner = false; }"
            @close="showQrScanner = false"
          />

          <div class="form-group">
            <label>パーツ名</label>
            <input v-model="formData.name" placeholder="未入力で自動生成" />
          </div>

          <div v-if="part" class="form-group status-group">
            <label>状態</label>
            <div class="status-toggle">
              <button
                type="button"
                class="status-btn"
                :class="{ active: !isUsed }"
                @click="toggleUsedState(false)"
              >
                通常在庫
              </button>
              <button
                type="button"
                class="status-btn"
                :class="{ active: isUsed }"
                @click="toggleUsedState(true)"
              >
                使用済み
              </button>
            </div>
            <small class="field-note">使用済みにすると保管場所はクリアされ、使用済み画面へ移動します。</small>
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
              <select v-model="formData.location_id" :disabled="isUsed">
                <option value="">保管場所を選択</option>
                <option v-for="loc in locations" :key="loc.id" :value="loc.id">
                  {{ loc.name }}
                </option>
              </select>
            </div>
          </div>

          <div v-if="part && isUsed" class="used-fields">
            <div class="form-group">
              <label>使用日時</label>
              <input :value="formatUsedAtForDisplay(formData.used_at)" disabled />
            </div>
            <div class="form-group">
              <label>使用先 *</label>
              <input v-model="formData.used_for" placeholder="例: 電源基板A" />
            </div>
            <div class="form-group">
              <label>使用メモ</label>
              <textarea v-model="formData.used_note" rows="3" placeholder="任意のメモを入力..."></textarea>
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

.status-group {
  gap: 0.75rem;
}

.status-toggle {
  display: flex;
  gap: 0.75rem;
}

.status-btn {
  flex: 1;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  padding: 0.75rem 1rem;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.status-btn.active {
  background: rgba(94, 234, 212, 0.15);
  border-color: var(--accent-color);
  color: var(--text-primary);
}

.field-note {
  color: var(--text-secondary);
  font-size: 0.8rem;
}

.used-fields {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
  border: 1px solid rgba(94, 234, 212, 0.18);
  border-radius: 10px;
  background: rgba(94, 234, 212, 0.05);
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

.qr-input-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.btn-scan {
  background: rgba(245, 158, 11, 0.2);
  color: #f59e0b;
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: 8px;
  padding: 0.5rem 0.75rem;
  cursor: pointer;
  font-size: 1.1rem;
  flex-shrink: 0;
}

.btn-scan:hover {
  background: rgba(245, 158, 11, 0.3);
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
