<script setup>
import { ref, onMounted } from 'vue';
import api from '../api';
import draggable from 'vuedraggable';
import MiniQrScanner from './MiniQrScanner.vue';
import { resizeImageFile } from '../utils/imageResize';

const props = defineProps({
    initialLocationEditId: {
        type: [Number, String],
        default: null
    }
});

const emit = defineEmits(['close']);

const categories = ref([]);
const locations = ref([]);
const tags = ref([]);
const newCategory = ref('');
const newLocation = ref('');
const newTag = ref('');

const loading = ref(false);
const activeTab = ref('locations'); // 'locations' | 'categories' | 'tags'

const editingId = ref(null);
const editingType = ref(null);
const editingName = ref('');
const editingDesc = ref('');
const editingQrCode = ref('');
const showQrScanner = ref(false);

const fetchData = async () => {
  try {
    const [catsRes, locsRes, tagsRes] = await Promise.all([
      api.get('/categories'),
      api.get('/locations'),
      api.get('/tags')
    ]);
    categories.value = catsRes.data;
    locations.value = locsRes.data;
    tags.value = tagsRes.data;

    if (props.initialLocationEditId && !editingId.value) {
        const loc = locations.value.find(l => l.id == props.initialLocationEditId);
        if (loc) {
            activeTab.value = 'locations';
            startEdit('location', loc);
        }
    }
  } catch (err) {
    console.error('Failed to load data', err);
  }
};

onMounted(fetchData);

const addCategory = async () => {
  if (!newCategory.value) return;
  try {
    await api.post('/categories', { name: newCategory.value });
    newCategory.value = '';
    fetchData();
  } catch (err) {
    alert('Failed to add category');
  }
};

const deleteCategory = async (id) => {
  if (!confirm('カテゴリを削除しますか?')) return;
  try {
    await api.delete(`/categories/${id}`);
    fetchData();
  } catch (err) {
    const msg = err.response?.data?.error || 'Failed to delete category';
    alert(msg);
  }
};

const newLocationImage = ref(null);
const editingImage = ref(null);
const resizingLocationImage = ref(false);
const resizingEditImage = ref(false);

const handleNewLocationImageChange = async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  resizingLocationImage.value = true;
  try {
    newLocationImage.value = await resizeImageFile(file);
  } catch (err) {
    console.error('画像リサイズ失敗:', err);
    newLocationImage.value = file;
  } finally {
    resizingLocationImage.value = false;
    e.target.value = '';
  }
};

const handleEditImageChange = async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  resizingEditImage.value = true;
  try {
    editingImage.value = await resizeImageFile(file);
  } catch (err) {
    console.error('画像リサイズ失敗:', err);
    editingImage.value = file;
  } finally {
    resizingEditImage.value = false;
    e.target.value = '';
  }
};

const addLocation = async () => {
  if (!newLocation.value || resizingLocationImage.value) return;
  try {
    const formData = new FormData();
    formData.append('name', newLocation.value);
    formData.append('description', '');
    if (newLocationImage.value) {
        formData.append('image', newLocationImage.value);
    }
    
    await api.post('/locations', formData);
    newLocation.value = '';
    newLocationImage.value = null;
    fetchData();
  } catch (err) {
    alert('Failed to add location');
  }
};

const deleteLocation = async (id) => {
  if (!confirm('保管場所を削除しますか?')) return;
  try {
    await api.delete(`/locations/${id}`);
    fetchData();
  } catch (err) {
    const msg = err.response?.data?.error || 'Failed to delete location';
    alert(msg);
  }
};

const addTag = async () => {
  if (!newTag.value) return;
  try {
    await api.post('/tags', { name: newTag.value });
    newTag.value = '';
    fetchData();
  } catch (err) {
    alert('Failed to add tag');
  }
};

const deleteTag = async (id) => {
  if (!confirm('タグを削除しますか?')) return;
  try {
    await api.delete(`/tags/${id}`);
    fetchData();
  } catch (err) {
    alert('Failed to delete tag');
  }
};

const startEdit = (type, item) => {
    editingId.value = item.id;
    editingType.value = type;
    editingName.value = item.name;
    editingImage.value = null;
    if (type === 'location') {
        editingDesc.value = item.description || '';
        editingQrCode.value = item.qr_code || '';
    }
};

const cancelEdit = () => {
    editingId.value = null;
    editingType.value = null;
    editingName.value = '';
    editingDesc.value = '';
    editingQrCode.value = '';
    editingImage.value = null;
    resizingEditImage.value = false;
};

const saveEdit = async () => {
    if (!editingName.value || resizingEditImage.value) return;
    try {
        if (editingType.value === 'category') {
            await api.put(`/categories/${editingId.value}`, { name: editingName.value });
        } else if (editingType.value === 'tag') {
            await api.put(`/tags/${editingId.value}`, { name: editingName.value });
        } else {
            const formData = new FormData();
            formData.append('name', editingName.value);
            formData.append('description', editingDesc.value);
            formData.append('qr_code', editingQrCode.value);
            if (editingImage.value) {
                formData.append('image', editingImage.value);
            }
            await api.put(`/locations/${editingId.value}`, formData);
        }
        fetchData();
        cancelEdit();
    } catch (err) {
        console.error(err);
        const msg = err.response?.data?.error || '更新に失敗しました';
        alert(msg);
    }
};

const onEnter = (e, callback) => {
    if (e.isComposing) return;
    callback();
};

const handleReorder = async (type, list) => {
    try {
        const ids = list.map(item => item.id);
        await api.post('/master/reorder', { type, ids });
    } catch (err) {
        console.error('Reorder failed', err);
        alert('順序の保存に失敗しました');
    }
};
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-content glass-panel">
      <h2>マスタデータ管理</h2>

      <!-- タブ切替 -->
      <div class="tab-bar">
        <button 
          class="tab-btn" 
          :class="{ active: activeTab === 'locations' }" 
          @click="activeTab = 'locations'"
        >🗄️ 保管場所</button>
        <button 
          class="tab-btn" 
          :class="{ active: activeTab === 'categories' }" 
          @click="activeTab = 'categories'"
        >📁 カテゴリ</button>
        <button 
          class="tab-btn" 
          :class="{ active: activeTab === 'tags' }" 
          @click="activeTab = 'tags'"
        >🏷️ タグ</button>
      </div>

      <!-- 保管場所 -->
      <div v-if="activeTab === 'locations'" class="tab-content">
        <div class="input-group">
          <input v-model="newLocation" placeholder="新しい保管場所" @keydown.enter="onEnter($event, addLocation)" />
          <div class="file-upload-mini">
            <label class="btn-icon camera-icon" :class="{ 'opacity-50': resizingLocationImage }">
              📷
              <input type="file" accept="image/*" class="hidden-input" :disabled="resizingLocationImage" @change="handleNewLocationImageChange">
            </label>
          </div>
          <button class="btn btn-primary" :disabled="resizingLocationImage" @click="addLocation">+</button>
        </div>
        <div v-if="resizingLocationImage" class="preview-mini text-warning">
            <span>🔄 画像を最適化中...</span>
        </div>
        <div v-else-if="newLocationImage" class="preview-mini">
            <span>画像選択中: {{ newLocationImage.name }} ({{ Math.round(newLocationImage.size / 1024) }} KB)</span>
            <button @click="newLocationImage = null" class="btn-icon text-danger">×</button>
        </div>

        <draggable 
          v-model="locations" 
          item-key="id" 
          tag="ul" 
          class="list"
          handle=".drag-handle"
          @change="handleReorder('locations', locations)"
        >
          <template #item="{ element: loc }">
              <li>
                <template v-if="editingId === loc.id && editingType === 'location'">
                     <div class="edit-group-col">
                        <input v-model="editingName" @keydown.enter="onEnter($event, saveEdit)" placeholder="名前" />
                        <input v-model="editingDesc" placeholder="説明" />
                        <div class="qr-input-row">
                          <input v-model="editingQrCode" placeholder="🏷️ QRコード（任意）" />
                          <button type="button" class="btn-icon btn-scan" @click="showQrScanner = true">📷</button>
                        </div>

                        <MiniQrScanner
                          v-if="showQrScanner"
                          @scanned="(code) => { editingQrCode = code; showQrScanner = false; }"
                          @close="showQrScanner = false"
                        />
                        
                        <div class="edit-image-row">
                            <label class="btn btn-sm btn-outline" :class="{ 'opacity-50': resizingEditImage }">
                              画像変更
                              <input type="file" accept="image/*" class="hidden-input" :disabled="resizingEditImage" @change="handleEditImageChange">
                            </label>
                            <span v-if="resizingEditImage" class="text-warning">🔄 最適化中...</span>
                            <span v-else-if="editingImage" class="text-success">変更あり ({{ Math.round(editingImage.size / 1024) }} KB)</span>
                        </div>
  
                        <div class="edit-actions">
                            <button class="btn-icon text-success" :disabled="resizingEditImage" @click="saveEdit">✅</button>
                            <button class="btn-icon text-danger" @click="cancelEdit">❌</button>
                        </div>
                     </div>
                </template>
                <template v-else>
                    <div class="list-item-content">
                        <div class="list-item-main">
                            <span class="drag-handle">☰</span>
                            <img v-if="loc.image_path" :src="`${api.defaults.baseURL.replace('/api', '')}${loc.image_path}`" class="loc-thumb" />
                            <div class="loc-info">
                                <span class="loc-name">{{ loc.name }}</span>
                                <span v-if="loc.qr_code" class="loc-qr">🏷️ {{ loc.qr_code }}</span>
                                <span v-if="loc.description" class="loc-desc">{{ loc.description }}</span>
                            </div>
                        </div>
                        <div class="actions">
                            <button class="btn-icon" @click="startEdit('location', loc)">✏️</button>
                            <button class="btn-icon" @click="deleteLocation(loc.id)">🗑</button>
                        </div>
                    </div>
                </template>
              </li>
          </template>
        </draggable>
      </div>

      <!-- カテゴリ -->
      <div v-if="activeTab === 'categories'" class="tab-content">
        <div class="input-group">
          <input v-model="newCategory" placeholder="新しいカテゴリ" @keydown.enter="onEnter($event, addCategory)" />
          <button class="btn btn-primary" @click="addCategory">+</button>
        </div>
        <draggable 
          v-model="categories" 
          item-key="id" 
          tag="ul" 
          class="list"
          handle=".drag-handle"
          @change="handleReorder('categories', categories)"
        >
          <template #item="{ element: cat }">
              <li>
                <template v-if="editingId === cat.id && editingType === 'category'">
                    <div class="edit-group">
                        <input v-model="editingName" @keydown.enter="onEnter($event, saveEdit)" />
                        <button class="btn-icon text-success" @click="saveEdit">✅</button>
                        <button class="btn-icon text-danger" @click="cancelEdit">❌</button>
                    </div>
                </template>
                <template v-else>
                    <span class="drag-handle">☰</span>
                    <span>{{ cat.name }}</span>
                    <div class="actions">
                        <button class="btn-icon" @click="startEdit('category', cat)">✏️</button>
                        <button class="btn-icon" @click="deleteCategory(cat.id)">🗑</button>
                    </div>
                </template>
              </li>
          </template>
        </draggable>
      </div>

      <!-- タグ -->
      <div v-if="activeTab === 'tags'" class="tab-content">
        <div class="input-group">
          <input v-model="newTag" placeholder="新しいタグ" @keydown.enter="onEnter($event, addTag)" />
          <button class="btn btn-primary" @click="addTag">+</button>
        </div>
        <draggable 
          v-model="tags" 
          item-key="id" 
          tag="ul" 
          class="list"
          handle=".drag-handle"
          @change="handleReorder('tags', tags)"
        >
          <template #item="{ element: tag }">
              <li>
                <template v-if="editingId === tag.id && editingType === 'tag'">
                    <div class="edit-group">
                        <input v-model="editingName" @keydown.enter="onEnter($event, saveEdit)" />
                        <button class="btn-icon text-success" @click="saveEdit">✅</button>
                        <button class="btn-icon text-danger" @click="cancelEdit">❌</button>
                    </div>
                </template>
                <template v-else>
                    <span class="drag-handle">☰</span>
                    <span>{{ tag.name }}</span>
                    <div class="actions">
                        <button class="btn-icon" @click="startEdit('tag', tag)">✏️</button>
                        <button class="btn-icon" @click="deleteTag(tag.id)">🗑</button>
                    </div>
                </template>
              </li>
          </template>
        </draggable>
      </div>

      <div class="footer">
        <button class="btn" @click="$emit('close')">閉じる</button>
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
  justify-content: center;
  align-items: center;
  z-index: 1000;
  padding: 1rem;
}

.modal-content {
  background: #1e293b;
  padding: 1.5rem;
  width: 100%;
  max-width: 600px;
  max-height: 85vh;
  overflow-y: auto;
  border-radius: 12px;
}

h2 {
  margin-bottom: 1rem;
  color: var(--accent-color);
}

/* タブバー */
.tab-bar {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
  background: rgba(0,0,0,0.2);
  padding: 0.25rem;
  border-radius: 10px;
}

.tab-btn {
  flex: 1;
  padding: 0.6rem 0.5rem;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-weight: 600;
  font-size: 0.9rem;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.tab-btn:hover {
  color: white;
}

.tab-btn.active {
  background: rgba(14, 165, 233, 0.2);
  color: var(--accent-color);
}

/* タブコンテンツ */
.tab-content {
  min-height: 200px;
}

.input-group {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

input {
  flex: 1;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border-color);
  padding: 0.6rem;
  border-radius: 8px;
  color: white;
  font-family: inherit;
}

input:focus {
  outline: none;
  border-color: var(--accent-color);
}

.list {
  list-style: none;
  max-height: 400px;
  overflow-y: auto;
}

.list li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.6rem;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}

.list li:hover {
  background: rgba(255,255,255,0.05);
}

.btn-icon {
  background: transparent;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  border-radius: 6px;
  border: none;
  cursor: pointer;
}

.btn-icon:hover {
  background: rgba(255, 255, 255, 0.1);
}

.actions {
    display: flex;
    gap: 0.25rem;
}

.edit-group {
    display: flex;
    gap: 0.5rem;
    flex: 1;
    align-items: center;
}

.text-success { color: var(--success); }
.text-danger { color: var(--danger); }
.text-warning { color: #f59e0b; }
.opacity-50 { opacity: 0.5; pointer-events: none; }

.footer {
  margin-top: 1.5rem;
  display: flex;
  justify-content: flex-end;
}

.file-upload-mini {
    display: flex;
    align-items: center;
}

.camera-icon {
    font-size: 1.2rem;
    cursor: pointer;
}

.preview-mini {
    font-size: 0.8rem;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
}

.list-item-content {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
}

.list-item-main {
    display: flex;
    align-items: center;
    gap: 0.8rem;
}

.loc-thumb {
    width: 40px;
    height: 40px;
    object-fit: cover;
    border-radius: 6px;
    border: 1px solid var(--border-color);
}

.loc-info {
    display: flex;
    flex-direction: column;
}

.loc-name {
    font-weight: 600;
}

.loc-desc {
    font-size: 0.8rem;
    color: var(--text-secondary);
}

.loc-qr {
    font-size: 0.75rem;
    font-family: monospace;
    color: #f59e0b;
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
    border-radius: 6px;
    cursor: pointer;
    font-size: 1.1rem;
}

.edit-group-col {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: 100%;
}

.edit-image-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    font-size: 0.9rem;
}

.edit-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
}

.hidden-input {
  display: none;
}

.drag-handle {
    cursor: grab;
    color: var(--text-secondary);
    margin-right: 0.5rem;
    font-size: 1.2rem;
    display: inline-flex;
    align-items: center;
}

.drag-handle:active {
    cursor: grabbing;
}

</style>
