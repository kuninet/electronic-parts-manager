<script setup>
import { ref, onMounted } from 'vue';
import api from '../api';

const emit = defineEmits(['close']);

const categories = ref([]);
const locations = ref([]);
const newCategory = ref('');
const newLocation = ref('');

const loading = ref(false);

const editingId = ref(null);
const editingType = ref(null); // 'category' or 'location'
const editingName = ref('');
const editingDesc = ref('');

const fetchData = async () => {
  try {
    const [catsRes, locsRes] = await Promise.all([
      api.get('/categories'),
      api.get('/locations')
    ]);
    categories.value = catsRes.data;
    locations.value = locsRes.data;
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
    alert('Failed to delete category');
  }
};

const newLocationImage = ref(null);
const editingImage = ref(null);

const addLocation = async () => {
  if (!newLocation.value) return;
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
    alert('Failed to delete location');
  }
};

const startEdit = (type, item) => {
    editingId.value = item.id;
    editingType.value = type;
    editingName.value = item.name;
    editingImage.value = null; // Reset
    if (type === 'location') editingDesc.value = item.description || '';
};

const cancelEdit = () => {
    editingId.value = null;
    editingType.value = null;
    editingName.value = '';
    editingDesc.value = '';
    editingImage.value = null;
};

const saveEdit = async () => {
    if (!editingName.value) return;
    try {
        if (editingType.value === 'category') {
            await api.put(`/categories/${editingId.value}`, { name: editingName.value });
        } else {
            const formData = new FormData();
            formData.append('name', editingName.value);
            formData.append('description', editingDesc.value);
            if (editingImage.value) {
                formData.append('image', editingImage.value);
            }
            await api.put(`/locations/${editingId.value}`, formData);
        }
        fetchData();
        cancelEdit();
    } catch (err) {
        console.error(err);
        alert('Updates failed');
    }
};
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-content glass-panel">
      <h2>マスタデータ管理</h2>

      <div class="row">
        <!-- Categories -->
        <div class="col">
          <h3>カテゴリ</h3>
          <div class="input-group">
            <input v-model="newCategory" placeholder="新しいカテゴリ" @keyup.enter="addCategory" />
            <button class="btn btn-primary" @click="addCategory">+</button>
          </div>
          <ul class="list">
            <li v-for="cat in categories" :key="cat.id">
              <template v-if="editingId === cat.id && editingType === 'category'">
                  <div class="edit-group">
                      <input v-model="editingName" @keyup.enter="saveEdit" />
                      <button class="btn-icon text-success" @click="saveEdit">✅</button>
                      <button class="btn-icon text-danger" @click="cancelEdit">❌</button>
                  </div>
              </template>
              <template v-else>
                  <span>{{ cat.name }}</span>
                  <div class="actions">
                      <button class="btn-icon" @click="startEdit('category', cat)">✏️</button>
                      <button class="btn-icon" @click="deleteCategory(cat.id)">🗑</button>
                  </div>
              </template>
            </li>
          </ul>
        </div>

        <!-- Locations -->
        <div class="col">
          <h3>保管場所</h3>
          <div class="input-group">
            <input v-model="newLocation" placeholder="新しい保管場所" @keyup.enter="addLocation" />
            <div class="file-upload-mini">
              <label class="btn-icon camera-icon">
                📷
                <input type="file" accept="image/*" class="hidden-input" @change="e => newLocationImage = e.target.files[0]">
              </label>
            </div>
            <button class="btn btn-primary" @click="addLocation">+</button>
          </div>
          <div v-if="newLocationImage" class="preview-mini">
              <span>画像選択中: {{ newLocationImage.name }}</span>
              <button @click="newLocationImage = null" class="btn-icon text-danger">×</button>
          </div>

          <ul class="list">
            <li v-for="loc in locations" :key="loc.id">
              <template v-if="editingId === loc.id && editingType === 'location'">
                   <div class="edit-group-col">
                      <input v-model="editingName" @keyup.enter="saveEdit" placeholder="名前" />
                      <input v-model="editingDesc" placeholder="説明" />
                      
                      <div class="edit-image-row">
                          <label class="btn btn-sm btn-outline">
                            画像変更
                            <input type="file" accept="image/*" class="hidden-input" @change="e => editingImage = e.target.files[0]">
                          </label>
                          <span v-if="editingImage" class="text-success">変更あり</span>
                      </div>

                      <div class="edit-actions">
                          <button class="btn-icon text-success" @click="saveEdit">✅</button>
                          <button class="btn-icon text-danger" @click="cancelEdit">❌</button>
                      </div>
                   </div>
              </template>
              <template v-else>
                  <div class="list-item-content">
                      <div class="list-item-main">
                          <img v-if="loc.image_path" :src="`${api.defaults.baseURL.replace('/api', '')}${loc.image_path}`" class="loc-thumb" />
                          <div class="loc-info">
                              <span class="loc-name">{{ loc.name }}</span>
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
          </ul>
        </div>
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
}

.modal-content {
  background: #1e293b;
  padding: 2rem;
  width: 90%;
  max-width: 800px;
  max-height: 80vh;
  overflow-y: auto;
}

h2 {
  margin-bottom: 2rem;
  color: var(--accent-color);
}

.row {
  display: flex;
  gap: 2rem;
}

.col {
  flex: 1;
}

h3 {
  margin-bottom: 1rem;
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 0.5rem;
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
  padding: 0.5rem;
  border-radius: 4px;
  color: white;
}

.list {
  list-style: none;
  max-height: 300px;
  overflow-y: auto;
}

.list li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}

.list li:hover {
  background: rgba(255,255,255,0.05);
}

.btn-icon {
  background: transparent;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  border-radius: 4px;
}

.btn-icon:hover {
  background: rgba(255, 255, 255, 0.1);
  opacity: 1;
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

.footer {
  margin-top: 2rem;
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
    border-radius: 4px;
    border: 1px solid var(--border-color);
}

.loc-info {
    display: flex;
    flex-direction: column;
}

.loc-desc {
    font-size: 0.8rem;
    color: var(--text-secondary);
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
</style>
