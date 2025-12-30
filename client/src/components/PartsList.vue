<script setup>
import { ref, onMounted, watch } from 'vue';
import api from '../api';

const parts = ref([]);
const categories = ref([]);
const locations = ref([]);
const tags = ref([]);
const loading = ref(true);
const error = ref(null);

// Filters
const searchQuery = ref('');
const selectedCategory = ref('');
const selectedTag = ref('');

const selectedLocation = ref('');
const viewMode = ref('grid'); // 'grid' or 'list'

const fetchMetadata = async () => {
  try {
    const [catsRes, locsRes, tagsRes] = await Promise.all([
      api.get('/categories'),
      api.get('/locations'),
      api.get('/tags')
    ]);
    categories.value = catsRes.data;
    locations.value = locsRes.data;
    tags.value = tagsRes.data;
  } catch (err) {
    console.error('Failed to load metadata', err);
  }
};

const fetchParts = async () => {
  loading.value = true;
  try {
    const params = {};
    if (searchQuery.value) params.search = searchQuery.value;
    if (selectedCategory.value) params.category_id = selectedCategory.value;
    if (selectedLocation.value) params.location_id = selectedLocation.value;
    if (selectedTag.value) params.tag_id = selectedTag.value;
    
    const response = await api.get('/parts', { params });
    parts.value = response.data;
  } catch (err) {
    error.value = 'Failed to load parts';
    console.error(err);
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  fetchMetadata();
  fetchParts();
});

// Debounce search
let timeout;
watch([searchQuery, selectedCategory, selectedLocation, selectedTag], () => {
  clearTimeout(timeout);
  timeout = setTimeout(() => {
    fetchParts();
  }, 300);
});

const openDatasheet = (e, part) => {
  e.stopPropagation(); // Card click event prevented
  const url = part.datasheet_url || (part.datasheet_path || null);
  if (url) {
    window.open(url, '_blank');
  }
};
</script>

<template>
  <div class="parts-container">
    <div class="controls glass-panel">
      <input 
        v-model="searchQuery" 
        type="text" 
        placeholder="パーツ名や説明で検索..." 
        class="search-input"
      />
      
      <select v-model="selectedCategory" class="filter-select">
        <option value="">全てのカテゴリ</option>
        <option v-for="cat in categories" :key="cat.id" :value="cat.id">
          {{ cat.name }}
        </option>
      </select>

      <select v-model="selectedLocation" class="filter-select">
        <option value="">全ての保管場所</option>
        <option v-for="loc in locations" :key="loc.id" :value="loc.id">
          {{ loc.name }}
        </option>
      </select>

      <select v-model="selectedTag" class="filter-select">
        <option value="">全てのタグ</option>
        <option v-for="tag in tags" :key="tag.id" :value="tag.id">
          {{ tag.name }}
        </option>
      </select>

      <button class="btn btn-primary" @click="$emit('add')">
        + 追加
      </button>

      <div class="view-toggle">
        <button 
          class="btn-icon toggle-btn" 
          :class="{ active: viewMode === 'grid' }" 
          @click="viewMode = 'grid'"
          title="グリッド表示"
        >
          🔲
        </button>
        <button 
          class="btn-icon toggle-btn" 
          :class="{ active: viewMode === 'list' }" 
          @click="viewMode = 'list'"
          title="リスト表示"
        >
          📝
        </button>
      </div>
    </div>

    <div v-if="loading" class="loading">読み込み中...</div>
    <div v-else-if="error" class="error">{{ error }}</div>
    
    <div v-else>
      <!-- Grid View -->
      <div v-if="viewMode === 'grid'" class="parts-grid">
        <div v-for="part in parts" :key="part.id" class="part-card glass-panel" @click="$emit('edit', part)">
          <div class="part-image">
            <img v-if="part.image_path" :src="part.image_path" :alt="part.name" />
            <div v-else class="placeholder-image">⚡️</div>
          </div>
          <div class="part-info">
            <h3>{{ part.name }}</h3>
            <div class="tags-container" v-if="part.tags">
                <span v-for="tag in part.tags.split(',')" :key="tag" class="small-tag-pill">{{ tag }}</span>
            </div>
            <p class="category" v-if="part.category_name">{{ part.category_name }}</p>
            <div class="stock-badge" :class="{ 'low-stock': part.quantity < 5 }">
              {{ part.quantity }} pcs
            </div>
            <p class="location" v-if="part.location_name">📍 {{ part.location_name }}</p>
            
            <button 
              v-if="part.datasheet_url || part.datasheet_path" 
              class="btn-icon datasheet-link" 
              @click="(e) => openDatasheet(e, part)"
              title="データシートを開く"
            >
              📄
            </button>
          </div>
        </div>
      </div>

      <!-- List View -->
      <div v-if="viewMode === 'list'" class="parts-list glass-panel">
        <table>
          <thead>
            <tr>
              <th>画像</th>
              <th>パーツ名</th>
              <th>カテゴリ</th>
              <th>保管場所</th>
              <th>個数</th>
              <th>アクション</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="part in parts" :key="part.id" @click="$emit('edit', part)" class="list-row">
              <td class="col-img">
                <div class="list-thumb">
                   <img v-if="part.image_path" :src="part.image_path" :alt="part.name" />
                   <span v-else>⚡️</span>
                </div>
              </td>
              <td class="col-name">
                <div class="name-cell">
                  <span class="part-name">{{ part.name }}</span>
                  <div class="tags-container" v-if="part.tags">
                       <span v-for="tag in part.tags.split(',')" :key="tag" class="small-tag-pill">{{ tag }}</span>
                  </div>
                  <span class="part-desc" v-if="part.description">{{ part.description }}</span>
                </div>
              </td>
              <td>{{ part.category_name || '-' }}</td>
              <td>{{ part.location_name || '-' }}</td>
              <td>
                <span class="qty-badge" :class="{ 'low-stock': part.quantity < 5 }">
                  {{ part.quantity }}
                </span>
              </td>
              <td>
                <button 
                  v-if="part.datasheet_url || part.datasheet_path" 
                  class="btn-icon list-datasheet-btn" 
                  @click="(e) => openDatasheet(e, part)"
                  title="データシート"
                >
                  📄
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.controls {
  padding: 1rem;
  margin-bottom: 2rem;
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

.search-input {
  flex: 2;
  min-width: 200px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border-color);
  padding: 0.75rem 1rem;
  border-radius: 8px;
  color: white;
  font-size: 1rem;
}

.filter-select {
  flex: 1;
  min-width: 150px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border-color);
  padding: 0.75rem 1rem;
  border-radius: 8px;
  color: white;
  font-size: 1rem;
}

.search-input:focus, .filter-select:focus {
  border-color: var(--accent-color);
  outline: none;
}

.parts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 1.5rem;
}

.part-card {
  overflow: hidden;
  transition: transform 0.2s;
  cursor: pointer;
}

.part-card:hover {
  transform: translateY(-5px);
}

.part-image {
  height: 150px;
  background: rgba(0,0,0,0.2);
  display: flex;
  align-items: center;
  justify-content: center;
}

.part-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.placeholder-image {
  font-size: 3rem;
  opacity: 0.5;
}

.part-info {
  padding: 1rem;
  position: relative;
}

.part-info h3 {
  margin-bottom: 0.5rem;
  font-size: 1.1rem;
}

.category {
  font-size: 0.8rem;
  color: var(--text-secondary);
  background: rgba(255,255,255,0.1);
  display: inline-block;
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  margin-bottom: 0.5rem;
}

.stock-badge {
  position: absolute;
  top: 1rem;
  right: 1rem;
  background: var(--success);
  color: white;
  padding: 0.2rem 0.6rem;
  border-radius: 12px;
  font-size: 0.8rem;
  font-weight: bold;
}

.stock-badge.low-stock {
  background: var(--warning);
}

.location {
  font-size: 0.9rem;
  color: var(--text-secondary);
  margin-top: 0.5rem;
}

.datasheet-link {
  position: absolute;
  bottom: 1rem;
  right: 1rem;
  background: rgba(255, 255, 255, 0.1);
  color: var(--accent-color);
  border: 1px solid var(--border-color);
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.2rem;
  transition: all 0.2s;
  z-index: 2;
}

.datasheet-link:hover {
  background: var(--accent-color);
  color: white;
  transform: scale(1.1);
}

/* View Toggle */
.view-toggle {
  display: flex;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}

.toggle-btn {
  padding: 0.5rem 1rem;
  font-size: 1.2rem;
  cursor: pointer;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  transition: all 0.2s;
}

.toggle-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
}

.toggle-btn.active {
  background: var(--accent-color);
  color: white;
}

/* List View */
.parts-list {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th {
  text-align: left;
  padding: 1rem;
  border-bottom: 2px solid var(--border-color);
  color: var(--text-secondary);
  font-weight: 600;
}

td {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  vertical-align: middle;
}

.list-row {
  cursor: pointer;
  transition: background-color 0.2s;
}

.list-row:hover {
  background-color: rgba(255, 255, 255, 0.05);
}

.col-img {
  width: 60px;
}

.list-thumb {
  width: 40px;
  height: 40px;
  background: rgba(0,0,0,0.2);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  font-size: 1.2rem;
}

.list-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.name-cell {
  display: flex;
  flex-direction: column;
}

.part-name {
  font-weight: bold;
  font-size: 1rem;
}

.part-desc {
  font-size: 0.8rem;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}

.qty-badge {
  background: rgba(255, 255, 255, 0.1);
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  font-weight: bold;
}

.qty-badge.low-stock {
  color: var(--warning);
  background: rgba(245, 158, 11, 0.1);
}

.list-datasheet-btn {
  background: transparent;
  color: var(--text-secondary);
  font-size: 1.2rem;
  padding: 0.4rem;
  border-radius: 4px;
  transition: all 0.2s;
}

.list-datasheet-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--accent-color);
}

@media (max-width: 768px) {
  .parts-grid {
    grid-template-columns: 1fr; /* Single column on mobile */
  }

  .controls {
    flex-direction: column;
    align-items: stretch;
    gap: 0.75rem;
  }

  .search-input, .filter-select {
    width: 100%;
    min-width: 0;
  }
  
  .part-card {
    display: flex; /* Horizontal card on mobile if desired, or keep as card */
  }

  /* Optimize List View */
  .parts-list table, .parts-list thead, .parts-list tbody, .parts-list th, .parts-list td, .parts-list tr {
    display: block;
  }

  .parts-list thead tr {
    position: absolute;
    top: -9999px;
    left: -9999px;
  }

  .parts-list tr {
    border-bottom: 2px solid rgba(255,255,255,0.1);
    margin-bottom: 1rem;
    padding-bottom: 0.5rem;
  }

  .parts-list td {
    border: none;
    position: relative;
    padding-left: 50%;
    text-align: right;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .parts-list td:before {
    position: absolute;
    left: 6px;
    width: 45%;
    padding-right: 10px;
    white-space: nowrap;
    text-align: left;
    font-weight: bold;
    color: var(--text-secondary);
  }

  /* Labeling for mobile list view */
  .parts-list td:nth-of-type(1):before { content: "画像"; }
  .parts-list td:nth-of-type(2):before { content: "パーツ名"; }
  .parts-list td:nth-of-type(3):before { content: "カテゴリ"; }
  .parts-list td:nth-of-type(4):before { content: "保管場所"; }
  .parts-list td:nth-of-type(5):before { content: "個数"; }
  .parts-list td:nth-of-type(6):before { content: "アクション"; }

  .parts-list td.col-img, .parts-list td.col-name {
    padding-left: 0;
    display: block;
    text-align: left;
  }
  
  .parts-list td.col-img:before, .parts-list td.col-name:before {
    display: none;
  }

  .list-thumb {
    width: 60px;
    height: 60px;
    margin-bottom: 0.5rem;
  }
  
  .name-cell {
    align-items: flex-start;
  }
}


.tags-container {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-bottom: 0.5rem;
}

.small-tag-pill {
  background: rgba(30, 200, 255, 0.15); /* More blueish */
  color: #5eead4; /* Accent color */
  padding: 0.1rem 0.5rem;
  border-radius: 8px;
  font-size: 0.75rem;
  border: 1px solid rgba(94, 234, 212, 0.3);
  display: inline-flex;
  align-items: center;
}

.small-tag-pill:before {
  content: "#";
  margin-right: 2px;
  opacity: 0.7;
}
</style>
