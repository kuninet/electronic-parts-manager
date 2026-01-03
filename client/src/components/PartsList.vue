<script setup>
import { ref, onMounted, watch } from 'vue';
import api from '../api';
import TagInput from './TagInput.vue';

const props = defineProps({
  initialLocationId: {
    type: [Number, String],
    default: ''
  }
});

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

const selectedLocation = ref(props.initialLocationId || '');
const viewMode = ref('grid'); // 'grid' or 'list'
const showTrash = ref(false);
const selectedItems = ref(new Set());
const isSelecting = ref(false);

const gridSize = ref('medium'); // 'small', 'medium', 'large'

// Sorting
const sortField = ref('id');
const sortOrder = ref('desc');

// Inline Editing
const editingPartId = ref(null);
const editingForm = ref({
    name: '',
    category_id: '',
    location_id: '',
    quantity: 0,
    tags: []
});

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

    if (showTrash.value) params.status = 'trash';
    
    // Sorting parameters
    params.sort = sortField.value;
    params.order = sortOrder.value;

    const response = await api.get('/parts', { params });
    parts.value = response.data;
    selectedItems.value.clear(); // Clear selection on reload
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
watch([searchQuery, selectedCategory, selectedLocation, selectedTag, showTrash, sortField, sortOrder], () => {
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

const toggleSelection = (part) => {
    if (selectedItems.value.has(part.id)) {
        selectedItems.value.delete(part.id);
    } else {
        selectedItems.value.add(part.id);
    }
};

const toggleSelectAll = () => {
    if (selectedItems.value.size === parts.value.length) {
        selectedItems.value.clear();
    } else {
        parts.value.forEach(p => selectedItems.value.add(p.id));
    }
};

const handleBulkAction = async (action) => {
    if (selectedItems.value.size === 0) return;
    if (!confirm(`${selectedItems.value.size}個のアイテムを${action === 'delete' ? '完全に削除' : action === 'trash' ? 'ゴミ箱へ移動' : '復元'}しますか？`)) return;

    loading.value = true;
    try {
        await api.post('/parts/bulk/action', {
            ids: Array.from(selectedItems.value),
            action
        });
        await fetchParts();
        selectedItems.value.clear();
    } catch (err) {
        alert('操作に失敗しました');
        console.error(err);
    } finally {
        loading.value = false;
    }
};

const startInlineEdit = (part) => {
    editingPartId.value = part.id;
    editingForm.value = {
        name: part.name,
        category_id: part.category_id || '',
        location_id: part.location_id || '',
        quantity: part.quantity || 0,
        tags: part.tags ? part.tags.split(',').filter(t => t) : []
    };
};

const cancelInlineEdit = () => {
    editingPartId.value = null;
    editingForm.value = {};
};

const saveInlineEdit = async (part) => {
    try {
        const formData = new FormData();
        // Required fields per existing API contract
        formData.append('name', editingForm.value.name);
        formData.append('category_id', editingForm.value.category_id || '');
        formData.append('location_id', editingForm.value.location_id || '');
        formData.append('quantity', editingForm.value.quantity);
        formData.append('tags', editingForm.value.tags.join(','));
        
        // Preserve other fields
        formData.append('description', part.description || '');
        formData.append('datasheet_url', part.datasheet_url || '');

        await api.put(`/parts/${part.id}`, formData);
        await fetchParts(); // Refresh list
        cancelInlineEdit();
    } catch (err) {
        alert('Saved failed');
        console.error(err);
    }
};

const openDatasheetFile = (part) => {
    if (part.datasheet_path) {
        // Use relative path if VITE_API_URL is not set (relying on proxy)
        const baseUrl = import.meta.env.VITE_API_URL || '';
        const url = `${baseUrl}${part.datasheet_path}`;
        window.open(url, '_blank');
    }
};

const openDatasheetUrl = (part) => {
    if (part.datasheet_url) {
        window.open(part.datasheet_url, '_blank');
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

      <div class="sort-controls">
         <select v-model="sortField" class="filter-select sort-select">
            <option value="id">登録順</option>
            <option value="name">名前順</option>
            <option value="category">カテゴリ順</option>
            <option value="location">保管場所順</option>
            <option value="quantity">個数順</option>
         </select>
         <button class="btn-icon sort-order-btn" @click="sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'" :title="sortOrder === 'asc' ? '昇順' : '降順'">
             {{ sortOrder === 'asc' ? '⬆️' : '⬇️' }}
         </button>
      </div>

      <div v-if="viewMode === 'grid'" class="grid-size-controls">
          <button class="btn-icon size-btn" :class="{ active: gridSize === 'small' }" @click="gridSize = 'small'" title="小">S</button>
          <button class="btn-icon size-btn" :class="{ active: gridSize === 'medium' }" @click="gridSize = 'medium'" title="中">M</button>
          <button class="btn-icon size-btn" :class="{ active: gridSize === 'large' }" @click="gridSize = 'large'" title="大">L</button>
      </div>

      <button class="btn btn-primary" @click="$emit('add')" v-if="!showTrash">
        + 追加
      </button>

      <button 
        class="btn hover-danger" 
        :class="{ active: showTrash }"
        @click="showTrash = !showTrash"
        title="ゴミ箱モード切り替え"
      >
        <span v-if="!showTrash">🗑️ ゴミ箱を表示</span>
        <span v-else>🔙 一覧に戻る</span>
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

    <!-- Bulk Actions Bar -->
    <div v-if="selectedItems.size > 0" class="bulk-actions glass-panel">
        <span class="selection-count">{{ selectedItems.size }}個選択中</span>
        <div class="bulk-buttons">
            <template v-if="!showTrash">
                <button class="btn btn-danger" @click="handleBulkAction('trash')">🗑️ ゴミ箱へ</button>
            </template>
            <template v-else>
                <button class="btn btn-success" @click="handleBulkAction('restore')">♻️ 復元</button>
                <button class="btn btn-danger" @click="handleBulkAction('delete')">❌ 完全削除</button>
            </template>
        </div>
    </div>

    <div v-if="loading" class="loading">読み込み中...</div>
    <div v-else-if="error" class="error">{{ error }}</div>
    
    <div v-else>
      <!-- Grid View -->
      <div v-if="viewMode === 'grid'" class="parts-grid" :class="gridSize">
        <div 
            v-for="part in parts" 
            :key="part.id" 
            class="part-card glass-panel" 
            :class="{ selected: selectedItems.has(part.id), 'editing': editingPartId === part.id }"
            @click="isSelecting ? toggleSelection(part) : (editingPartId === part.id ? null : $emit('edit', part))"
        >
          <div v-if="editingPartId !== part.id" class="card-view-content">
              <div class="card-selection" @click.stop>
                <input type="checkbox" :checked="selectedItems.has(part.id)" @change="toggleSelection(part)" />
              </div>

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
                
                <div class="card-icons">
                   <button 
                    class="btn-icon small-icon" 
                        @click.stop="startInlineEdit(part)"
                        title="編集"
                    >
                    ✏️
                    </button>
                   <button 
                    v-if="part.datasheet_path" 
                    class="btn-icon small-icon" 
                    @click.stop="openDatasheetFile(part)"
                    title="データシート (PDF)"
                    >
                    📄
                    </button>
                    <button 
                    v-if="part.datasheet_url" 
                    class="btn-icon small-icon" 
                    @click.stop="openDatasheetUrl(part)"
                    title="関連リンク"
                    >
                    🌐
                    </button>
               </div>
              </div>
          </div>
          <!-- Edit Mode Card -->
          <div v-else class="card-edit-content" @click.stop>
              <div class="card-edit-header">
                  <span class="edit-title">編集</span>
                  <div class="edit-actions">
                      <button class="btn-icon text-success" @click="saveInlineEdit(part)">✅</button>
                      <button class="btn-icon text-danger" @click="cancelInlineEdit">❌</button>
                  </div>
              </div>
              <div class="card-edit-form">
                  <input v-model="editingForm.name" class="inline-input" placeholder="パーツ名" />
                  <input type="number" v-model="editingForm.quantity" class="inline-input" placeholder="個数" />
                  <select v-model="editingForm.category_id" class="inline-select">
                      <option value="">(未分類)</option>
                      <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
                  </select>
                  <select v-model="editingForm.location_id" class="inline-select">
                      <option value="">(未設定)</option>
                      <option v-for="loc in locations" :key="loc.id" :value="loc.id">{{ loc.name }}</option>
                  </select>
                  <div class="grid-tag-input">
                      <TagInput v-model="editingForm.tags" :suggestions="tags" />
                  </div>
              </div>
          </div>
        </div>
      </div>

      <!-- List View -->
      <div v-if="viewMode === 'list'" class="parts-list glass-panel">
        <table>
          <thead>
            <tr>
              <th class="col-checkbox">
                <input type="checkbox" :checked="selectedItems.size === parts.length && parts.length > 0" @change="toggleSelectAll" />
              </th>
              <th>画像</th>
              <th>パーツ名</th>
              <th>カテゴリ</th>
              <th>保管場所</th>
              <th>個数</th>
              <th>アクション</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="part in parts" :key="part.id" @click="$emit('edit', part)" class="list-row" :class="{ selected: selectedItems.has(part.id) }">
              <td class="col-checkbox" @click.stop>
                 <input type="checkbox" :checked="selectedItems.has(part.id)" @change="toggleSelection(part)" />
              </td>
              <td class="col-img">
                <div class="list-thumb">
                   <img v-if="part.image_path" :src="part.image_path" :alt="part.name" />
                   <span v-else>⚡️</span>
                </div>
              </td>
              <td class="col-name">
                <div class="name-cell" v-if="editingPartId !== part.id">
                  <span class="part-name">{{ part.name }}</span>
                  <div class="tags-container" v-if="part.tags">
                       <span v-for="tag in part.tags.split(',')" :key="tag" class="small-tag-pill">{{ tag }}</span>
                  </div>
                  <span class="part-desc" v-if="part.description">{{ part.description }}</span>
                </div>
                <!-- Edit Mode: Name -->
                <div class="name-cell" v-else @click.stop>
                    <input v-model="editingForm.name" class="inline-input" placeholder="パーツ名" />
                    <div style="margin-top: 0.5rem;" @click.stop>
                        <TagInput v-model="editingForm.tags" :suggestions="tags" />
                    </div>
                </div>
              </td>
              <td>
                  <template v-if="editingPartId !== part.id">
                      {{ part.category_name || '-' }}
                  </template>
                  <!-- Edit Mode: Category -->
                  <div v-else @click.stop>
                      <select v-model="editingForm.category_id" class="inline-select">
                          <option value="">(未分類)</option>
                          <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
                      </select>
                  </div>
              </td>
              <td>
                  <template v-if="editingPartId !== part.id">
                      {{ part.location_name || '-' }}
                  </template>
                  <!-- Edit Mode: Location -->
                  <div v-else @click.stop>
                       <select v-model="editingForm.location_id" class="inline-select">
                          <option value="">(未設定)</option>
                          <option v-for="loc in locations" :key="loc.id" :value="loc.id">{{ loc.name }}</option>
                      </select>
                  </div>
              </td>
              <td>
                  <template v-if="editingPartId !== part.id">
                    <span class="qty-badge" :class="{ 'low-stock': part.quantity < 5 }">
                      {{ part.quantity }}
                    </span>
                  </template>
                  <!-- Edit Mode: Quantity -->
                  <div v-else @click.stop>
                      <input type="number" v-model="editingForm.quantity" class="inline-input qty-input" min="0" />
                  </div>
              </td>
              <td>
                <div class="action-cell">
                    <template v-if="editingPartId !== part.id">
                        <button 
                        class="btn-icon list-action-btn" 
                        @click.stop="startInlineEdit(part)"
                        title="編集"
                        >
                        ✏️
                        </button>
                        <button 
                        v-if="part.datasheet_path" 
                        class="btn-icon list-datasheet-btn" 
                        @click.stop="openDatasheetFile(part)"
                        title="データシート (PDF)"
                        >
                        📄
                        </button>
                         <button 
                        v-if="part.datasheet_url" 
                        class="btn-icon list-datasheet-btn" 
                        @click.stop="openDatasheetUrl(part)"
                        title="関連リンク"
                        >
                        🌐
                        </button>
                    </template>
                    <!-- Edit Mode: Actions -->
                    <template v-else>
                         <button class="btn-icon text-success" @click.stop="saveInlineEdit(part)">✅</button>
                         <button class="btn-icon text-danger" @click.stop="cancelInlineEdit">❌</button>
                    </template>
                </div>
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
  align-items: center;
}

.sort-controls {
    display: flex;
    gap: 0.5rem;
    align-items: center;
}

.sort-select {
    min-width: 110px;
}

.sort-order-btn {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--border-color);
    padding: 0.5rem;
    border-radius: 8px;
    cursor: pointer;
    font-size: 1rem;
}

.sort-order-btn:hover {
    background: rgba(255, 255, 255, 0.1);
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

/* Fix for dropdown options visibility */
select option {
    background-color: #1e293b;
    color: white;
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
  padding-right: 4.5rem; /* Avoid overlap with stock badge */
  word-break: break-all;
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

.card-icons {
    position: absolute;
    bottom: 1rem;
    right: 1rem;
    display: flex;
    gap: 0.5rem;
}

.small-icon {
    font-size: 1.2rem;
    padding: 0.2rem;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    border: 1px solid var(--border-color);
}

.small-icon:hover {
    background: rgba(255, 255, 255, 0.2);
}



/* View Toggle & Grid Size */
.view-toggle {
  display: flex;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}

.grid-size-controls {
    display: flex;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    overflow: hidden;
    margin-right: 0.5rem;
}

.size-btn {
    padding: 0.5rem 0.8rem;
    font-size: 0.9rem;
    cursor: pointer;
    background: transparent;
    border: none;
    color: var(--text-secondary);
    transition: all 0.2s;
    font-weight: bold;
}

.size-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
}

.size-btn.active {
  background: var(--accent-color);
  color: white;
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

.parts-grid {
  display: grid;
  gap: 1.5rem;
  /* Default Medium */
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
}

.parts-grid.small {
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 1rem;
}

.parts-grid.small .part-image { height: 120px; }
.parts-grid.small .part-info h3 { font-size: 1rem; }

.parts-grid.large {
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 2rem;
}

.parts-grid.large .part-image { height: 200px; }
.parts-grid.large .part-info h3 { font-size: 1.3rem; }


.part-card {
  overflow: hidden;
  transition: transform 0.2s;
  cursor: pointer;
  min-height: 300px;
  display: flex;
  flex-direction: column;
}

.part-card.editing {
    border: 2px solid var(--accent-color);
    transform: none !important;
    cursor: default;
}

.card-view-content {
    display: flex;
    flex-direction: column;
    height: 100%;
    position: relative;
}

.card-edit-content {
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    height: 100%;
}

.card-edit-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--border-color);
    padding-bottom: 0.5rem;
}

.edit-title {
    font-weight: bold;
    color: var(--accent-color);
}

.edit-actions {
    display: flex;
    gap: 0.5rem;
}

.card-edit-form {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    overflow-y: auto;
}

.grid-tag-input {
    min-height: 40px;
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

/* Bulk Actions */
.bulk-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem;
    margin-bottom: 1rem;
    background: rgba(30, 41, 59, 0.95);
    border: 1px solid var(--accent-color);
    position: sticky;
    top: 1rem;
    z-index: 10;
}

.selection-count {
    font-weight: bold;
    color: white;
}

.bulk-buttons {
    display: flex;
    gap: 0.5rem;
}

/* Selection Styles */
.part-card {
    position: relative;
}

.card-selection {
    position: absolute;
    top: 0.5rem;
    left: 0.5rem;
    z-index: 5;
}

.part-card.selected {
    border: 2px solid var(--accent-color);
    background: rgba(94, 234, 212, 0.05); /* Accent tint */
}

.list-row.selected {
    background: rgba(94, 234, 212, 0.1) !important;
}

.col-checkbox {
    width: 40px;
    text-align: center;
}

.hover-danger:hover {
    background-color: var(--danger) !important;
    border-color: var(--danger) !important;
}

.hover-danger.active {
    background-color: var(--danger);
    border-color: var(--danger);
}

.btn-success {
    background: var(--success);
    color: white;
    border: none;
}
.btn-danger {
    background: var(--danger);
    color: white;
    border: none;
}

/* Inline Editing Styles */
.inline-input, .inline-select {
    width: 100%;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid var(--border-color);
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    color: white;
}

.qty-input {
    width: 70px;
    text-align: right;
}

.action-cell {
    display: flex;
    gap: 0.5rem;
    align-items: center;
}

.list-action-btn {
  background: transparent;
  color: var(--text-secondary);
  font-size: 1rem;
  padding: 0.4rem;
  border-radius: 4px;
  transition: all 0.2s;
}
.list-action-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: var(--text-primary);
}

.text-success { color: var(--success); font-size: 1.2rem; }
.text-danger { color: var(--danger); font-size: 1.2rem; }
</style>
