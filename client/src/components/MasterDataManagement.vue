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

const addLocation = async () => {
  if (!newLocation.value) return;
  try {
    await api.post('/locations', { name: newLocation.value, description: '' });
    newLocation.value = '';
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
    if (type === 'location') editingDesc.value = item.description || '';
};

const cancelEdit = () => {
    editingId.value = null;
    editingType.value = null;
    editingName.value = '';
    editingDesc.value = '';
};

const saveEdit = async () => {
    if (!editingName.value) return;
    try {
        if (editingType.value === 'category') {
            await api.put(`/categories/${editingId.value}`, { name: editingName.value });
        } else {
            await api.put(`/locations/${editingId.value}`, { name: editingName.value, description: editingDesc.value });
        }
        fetchData();
        cancelEdit();
    } catch (err) {
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
            <button class="btn btn-primary" @click="addLocation">+</button>
          </div>
          <ul class="list">
            <li v-for="loc in locations" :key="loc.id">
              <template v-if="editingId === loc.id && editingType === 'location'">
                   <div class="edit-group">
                      <input v-model="editingName" @keyup.enter="saveEdit" />
                      <button class="btn-icon text-success" @click="saveEdit">✅</button>
                      <button class="btn-icon text-danger" @click="cancelEdit">❌</button>
                   </div>
              </template>
              <template v-else>
                  <span>{{ loc.name }}</span>
                  <div class="actions">
                      <button class="btn-icon" @click="startEdit('location', loc)">✏️</button>
                      <button class="btn-icon" @click="deleteLocation(loc.id)">🗑</button>
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
</style>
