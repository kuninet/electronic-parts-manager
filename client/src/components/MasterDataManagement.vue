<script setup>
import { ref, onMounted } from 'vue';
import api from '../api';

const emit = defineEmits(['close']);

const categories = ref([]);
const locations = ref([]);
const newCategory = ref('');
const newLocation = ref('');
const loading = ref(false);

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
              <span>{{ cat.name }}</span>
              <button class="btn-icon" @click="deleteCategory(cat.id)">🗑</button>
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
              <span>{{ loc.name }}</span>
              <button class="btn-icon" @click="deleteLocation(loc.id)">🗑</button>
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
  background: rgba(239, 68, 68, 0.2);
  color: var(--danger);
}

.footer {
  margin-top: 2rem;
  display: flex;
  justify-content: flex-end;
}
</style>
