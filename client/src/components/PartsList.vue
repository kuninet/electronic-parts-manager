<script setup>
import { ref, reactive, onMounted, onUnmounted, watch } from 'vue';
import api from '../api';
import TagInput from './TagInput.vue';
import BulkEditModal from './BulkEditModal.vue';
import MiniQrScanner from './MiniQrScanner.vue';

const HOVER_PREVIEW_DELAY_MS = 2000;
const HOVER_PREVIEW_WIDTH = 360;
const HOVER_PREVIEW_HEIGHT = 360;

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
    qr_code: '',
    tags: []
});

const showQrScanner = ref(false);
const hoverPreview = ref({
    visible: false,
    imageSrc: '',
    name: '',
    top: 0,
    left: 0
});
let hoverPreviewTimer = null;

const handleQrScan = (result) => {
    editingForm.value.qr_code = result;
    showQrScanner.value = false;
};

const supportsHoverPreview = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;

const resolveImageUrl = (imagePath) => {
    if (!imagePath) return '';
    if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) return imagePath;
    const baseUrl = import.meta.env.VITE_API_URL || '';
    return `${baseUrl}${imagePath}`;
};

const clampHoverPreviewPosition = (rect) => {
    const margin = 16;
    const maxLeft = Math.max(margin, window.innerWidth - HOVER_PREVIEW_WIDTH - margin);
    const maxTop = Math.max(margin, window.innerHeight - HOVER_PREVIEW_HEIGHT - margin);
    const preferredLeft = rect.right - (HOVER_PREVIEW_WIDTH * 0.32);
    const preferredTop = rect.top - 20;

    return {
        left: Math.min(Math.max(preferredLeft, margin), maxLeft),
        top: Math.min(Math.max(preferredTop, margin), maxTop)
    };
};

const hideHoverPreview = () => {
    if (hoverPreviewTimer) {
        clearTimeout(hoverPreviewTimer);
        hoverPreviewTimer = null;
    }
    hoverPreview.value.visible = false;
};

const scheduleHoverPreview = (event, part) => {
    if (!supportsHoverPreview() || !part.image_path || editingPartId.value === part.id) return;

    hideHoverPreview();
    const rect = event.currentTarget.getBoundingClientRect();
    hoverPreviewTimer = setTimeout(() => {
        const position = clampHoverPreviewPosition(rect);
        hoverPreview.value = {
            visible: true,
            imageSrc: resolveImageUrl(part.image_path),
            name: part.name,
            top: position.top,
            left: position.left
        };
        hoverPreviewTimer = null;
    }, HOVER_PREVIEW_DELAY_MS);
};

// 画像読み込み失敗時のリトライ（503エラー対策）
const retryImageLoad = (event) => {
    const img = event.target;
    const retryCount = parseInt(img.dataset.retryCount || '0');
    const maxRetries = 3;
    if (retryCount < maxRetries) {
        img.dataset.retryCount = retryCount + 1;
        const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
        setTimeout(() => {
            const originalSrc = img.src;
            img.src = '';
            img.src = originalSrc;
        }, delay);
    }
};

// 遅延レンダリング: 画面内に入った部品だけ描画する
const visibleParts = reactive(new Set());
let lazyObserver = null;

const initLazyObserver = () => {
    if (lazyObserver) lazyObserver.disconnect();
    lazyObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const partId = entry.target.dataset.partId;
                if (partId) visibleParts.add(Number(partId));
                lazyObserver.unobserve(entry.target);
            }
        });
    }, { rootMargin: '100px' }); // 100px手前から先読み（以前は200px）
};

// カスタムディレクティブ: 部品カード/行を監視対象に追加
const vLazyRender = {
    mounted(el) {
        if (lazyObserver) lazyObserver.observe(el);
    },
    unmounted(el) {
        if (lazyObserver) lazyObserver.unobserve(el);
    }
};

initLazyObserver();
onUnmounted(() => {
    if (lazyObserver) lazyObserver.disconnect();
    hideHoverPreview();
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
    visibleParts.clear(); // 遅延レンダリング用: 表示済みセットをリセット
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

const showBulkEdit = ref(false);

const handleBulkUpdate = async (updates) => {
    loading.value = true;
    try {
        await api.post('/parts/bulk/update', {
            ids: Array.from(selectedItems.value),
            updates
        });
        await fetchParts();
        selectedItems.value.clear();
        showBulkEdit.value = false;
        alert('一括変更を適用しました');
    } catch (err) {
        console.error(err);
        const msg = err.response?.data?.error || '変更に失敗しました';
        alert(msg);
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
        qr_code: part.qr_code || '',
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
        formData.append('qr_code', editingForm.value.qr_code || '');
        formData.append('tags', editingForm.value.tags.join(','));
        
        // Preserve other fields
        formData.append('description', part.description || '');
        formData.append('datasheet_url', part.datasheet_url || '');

        await api.put(`/parts/${part.id}`, formData);
        await fetchParts(); // Refresh list
        cancelInlineEdit();
    } catch (err) {
        console.error(err);
        const msg = err.response?.data?.error || 'Save failed';
        alert(msg);
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

// Quick Edit Logic
const editingNameId = ref(null);
const editNameModel = ref('');
const editingQtyId = ref(null);
const editQtyModel = ref(0);

const quickUpdatePart = async (part, changes) => {
    try {
        const formData = new FormData();
        // Construct full object from part + changes
        const merged = { ...part, ...changes };
        
        formData.append('name', merged.name);
        formData.append('quantity', merged.quantity);
        formData.append('category_id', merged.category_id || '');
        formData.append('location_id', merged.location_id || '');
        formData.append('tags', merged.tags || '');
        formData.append('description', merged.description || '');
        formData.append('datasheet_url', merged.datasheet_url || '');

        await api.put(`/parts/${part.id}`, formData);
        await fetchParts(); // Refresh
    } catch (err) {
        console.error(err);
        const msg = err.response?.data?.error || 'Update failed';
        alert(msg);
    }
};

const startNameEdit = (part) => {
    editingNameId.value = part.id;
    editNameModel.value = part.name;
    // Wait for DOM update to focus input (requires nextTick or similar, but template ref handling is easier)
};

const saveNameEdit = async (part) => {
    if (editingNameId.value !== part.id) return;
    if (editNameModel.value !== part.name) {
        await quickUpdatePart(part, { name: editNameModel.value });
    }
    editingNameId.value = null;
};

const startQtyEdit = (part) => {
    editingQtyId.value = part.id;
    editQtyModel.value = part.quantity;
};

const saveQtyEdit = async (part) => {
    if (editingQtyId.value !== part.id) return;
    if (editQtyModel.value != part.quantity) {
        await quickUpdatePart(part, { quantity: editQtyModel.value });
    }
    editingQtyId.value = null;
};

const quickRemoveTag = async (part, tagToRemove) => {
    if(!confirm(`タグ「${tagToRemove}」を削除しますか？`)) return;
    
    const currentTags = part.tags ? part.tags.split(',') : [];
    const newTags = currentTags.filter(t => t !== tagToRemove);
    await quickUpdatePart(part, { tags: newTags.join(',') });
};


const onEnter = (e, callback) => {
    if (e.isComposing) return;
    callback();
};

const vFocus = {
  mounted: (el) => el.focus()
};

defineExpose({ fetchParts });
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
                <button class="btn btn-secondary" @click="showBulkEdit = true">✏️ 一括編集</button>
                <button class="btn btn-danger" @click="handleBulkAction('trash')">🗑️ ゴミ箱へ</button>
            </template>
            <template v-else>
                <button class="btn btn-success" @click="handleBulkAction('restore')">♻️ 復元</button>
                <button class="btn btn-danger" @click="handleBulkAction('delete')">❌ 完全削除</button>
            </template>
        </div>
    </div>
    
    <BulkEditModal 
        v-if="showBulkEdit" 
        :selectedCount="selectedItems.size" 
        @close="showBulkEdit = false" 
        @save="handleBulkUpdate" 
    />

    <MiniQrScanner 
        v-if="showQrScanner" 
        @scanned="handleQrScan" 
        @close="showQrScanner = false"
    />

    <div v-if="loading" class="loading">読み込み中...</div>
    <div v-else-if="error" class="error">{{ error }}</div>
    
    <div v-else>
      <!-- Grid View -->
      <div v-if="viewMode === 'grid'" class="parts-grid" :class="gridSize">
        <div 
            v-for="part in parts" 
            :key="part.id" 
            v-lazy-render
            :data-part-id="part.id"
            class="part-card glass-panel" 
            :class="{ selected: selectedItems.has(part.id), 'editing': editingPartId === part.id }"
            @mouseenter="scheduleHoverPreview($event, part)"
            @mouseleave="hideHoverPreview"
            @click="hideHoverPreview(); isSelecting ? toggleSelection(part) : (editingPartId === part.id ? null : $emit('edit', part))"
        >
          <div v-if="editingPartId !== part.id" class="card-view-content">
              <div class="card-selection" @click.stop>
                <input type="checkbox" :checked="selectedItems.has(part.id)" @change="toggleSelection(part)" />
              </div>

              <div class="part-image">
                <template v-if="visibleParts.has(part.id)">
                  <img v-if="part.image_path" :src="part.image_path" :alt="part.name" loading="lazy" @error="retryImageLoad($event)" />
                  <div v-else class="placeholder-image">⚡️</div>
                </template>
                <div v-else class="placeholder-image skeleton-pulse"></div>
              </div>
              <div class="part-info">
                
                <!-- Quick Edit: Name -->
                <div v-if="editingNameId === part.id" class="name-edit-wrapper" @click.stop>
                    <input 
                        v-model="editNameModel" 
                        @blur="saveNameEdit(part)" 
                        @keydown.enter="onEnter($event, () => saveNameEdit(part))"
                        class="quick-edit-input"
                        ref="nameInput"
                        v-focus
                    />
                </div>
                <h3 v-else @click.stop="startNameEdit(part)" class="editable-text" title="クリックで編集">
                    {{ part.name }}
                </h3>
                <p v-if="part.qr_code" class="qr-code-badge" title="QRコード">
                    📱 {{ part.qr_code }}
                </p>

                <!-- Quick Edit: Tags -->
                <div class="tags-container" v-if="part.tags">
                    <span v-for="tag in part.tags.split(',')" :key="tag" class="small-tag-pill">
                        {{ tag }}
                    </span>
                </div>
                <p class="category" v-if="part.category_name">{{ part.category_name }}</p>
                
                <!-- Quick Edit: Quantity -->
                <div v-if="editingQtyId === part.id" class="stock-badge editing" @click.stop>
                     <input 
                        type="number"
                        v-model="editQtyModel" 
                        @blur="saveQtyEdit(part)" 
                        @keydown.enter="onEnter($event, () => saveQtyEdit(part))"
                        class="quick-edit-input-qty"
                        v-focus
                    />
                </div>
                <div v-else class="stock-badge editable-badge" :class="{ 'low-stock': part.quantity < 5 }" @click.stop="startQtyEdit(part)" title="クリックで編集">
                  {{ part.quantity }} pcs
                </div>

                <p class="location" v-if="part.location_name">📍 {{ part.location_name }}</p>
                
                <div class="card-icons">
                   <button 
                    class="btn-icon small-icon" 
                        @click.stop="startInlineEdit(part)"
                        title="詳細編集モード"
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
                  <div class="qr-edit-wrapper" style="display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.5rem;">
                      <input v-model="editingForm.qr_code" class="inline-input" placeholder="QRコード" />
                      <button class="btn-icon" @click.stop="showQrScanner = true" title="カメラでスキャン">📷</button>
                  </div>
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

      <div
        v-if="hoverPreview.visible"
        class="hover-image-preview"
        :style="{ top: `${hoverPreview.top}px`, left: `${hoverPreview.left}px` }"
      >
        <img :src="hoverPreview.imageSrc" :alt="hoverPreview.name" />
        <span>{{ hoverPreview.name }}</span>
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
              <th class="hide-on-mobile">カテゴリ</th>
              <th class="col-loc-header">保管場所</th>
              <th>個数</th>
              <th>アクション</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="part in parts" :key="part.id" v-lazy-render :data-part-id="part.id" @click="$emit('edit', part)" class="list-row" :class="{ selected: selectedItems.has(part.id) }">
              <td class="col-checkbox" @click.stop>
                 <input type="checkbox" :checked="selectedItems.has(part.id)" @change="toggleSelection(part)" />
              </td>
              <td class="col-img">
                <div class="list-thumb">
                  <template v-if="visibleParts.has(part.id)">
                   <img v-if="part.image_path" :src="part.image_path" :alt="part.name" loading="lazy" @error="retryImageLoad($event)" />
                   <span v-else>⚡️</span>
                  </template>
                  <div v-else class="skeleton-pulse" style="width:40px;height:40px;"></div>
                </div>
              </td>
              <td class="col-name">
                <div class="name-cell" v-if="editingPartId !== part.id">
                  <div class="name-row">
                    <span class="part-name">{{ part.name }}</span>
                    <span v-if="part.qr_code" class="qr-code-badge list-qr">📱 {{ part.qr_code }}</span>
                  </div>
                  <div class="tags-container" v-if="part.tags">
                       <span v-for="tag in part.tags.split(',')" :key="tag" class="small-tag-pill">{{ tag }}</span>
                  </div>
                  <span class="part-desc" v-if="part.description">{{ part.description }}</span>
                </div>
                <!-- Edit Mode: Name -->
                <div class="name-cell" v-else @click.stop>
                    <input v-model="editingForm.name" class="inline-input" placeholder="パーツ名" />
                    <div class="qr-edit-wrapper" style="margin-top: 0.5rem; display: flex; gap: 0.5rem; align-items: center;">
                        <input v-model="editingForm.qr_code" class="inline-input" placeholder="QRコード" />
                        <button class="btn-icon" @click.stop="showQrScanner = true" title="カメラでスキャン">📷</button>
                    </div>
                    <div style="margin-top: 0.5rem;" @click.stop>
                        <TagInput v-model="editingForm.tags" :suggestions="tags" />
                    </div>
                </div>
              </td>
              <td class="hide-on-mobile">
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
              <td class="col-loc">
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
  width: 100%;
  height: 100%;
  display: flex !important;
  align-items: center;
  justify-content: center;
  font-size: 3rem;
  opacity: 0.5;
}

.part-info {
  padding: 1rem;
  position: relative;
  min-height: 110px; /* Increased to 110px to definitely prevent badge/icon overlap */
}

.part-info h3 {
  margin-bottom: 0.5rem;
  font-size: 1.1rem;
  padding-right: 4.5rem; /* Avoid overlap with stock badge */
  word-break: break-all;
}

.qr-code-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.75rem;
    font-family: monospace;
    background: rgba(245, 158, 11, 0.15);
    color: #fcd34d;
    padding: 0.1rem 0.5rem;
    border-radius: 4px;
    border: 1px solid rgba(245, 158, 11, 0.3);
    width: fit-content;
    white-space: nowrap;
}

.list-qr {
  display: inline-flex;
}

.name-row {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  flex-wrap: wrap;
  line-height: 1.2;
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

/* Quick Edit Styles */
.editable-text {
    cursor: pointer;
    border-bottom: 1px dashed transparent;
    transition: border-color 0.2s;
}

.editable-text:hover {
    border-bottom-color: var(--accent-color);
}

.quick-edit-input {
    width: 100%;
    background: rgba(0,0,0,0.3);
    border: 1px solid var(--accent-color);
    color: white;
    font-size: 1.1rem;
    font-weight: bold;
    padding: 0.2rem 0.5rem;
    padding-right: 4.5rem; /* Avoid overlap with stock badge */
    border-radius: 4px;
}

.quick-edit-input-qty {
    width: 60px;
    background: rgba(0,0,0,0.3);
    border: 1px solid white;
    color: white;
    font-size: 0.8rem;
    font-weight: bold;
    padding: 0;
    text-align: center;
    border-radius: 4px;
}

.editable-tag {
    /* position: relative; padding-right: 1.2rem; Tag delete removed per user request */
}

.editable-badge {
    cursor: pointer;
    transition: transform 0.1s;
}

.editable-badge:hover {
    transform: scale(1.1);
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
  .parts-list table, .parts-list tbody {
    display: block;
    width: 100%;
  }

  .parts-list thead {
    display: none;
  }

  .parts-list tr {
    display: grid;
    grid-template-areas:
      "chk img name qty action"
      ".   img loc  loc loc";
    grid-template-columns: 24px 46px 1fr auto 40px;
    grid-template-rows: auto auto;
    gap: 0.1rem 0.5rem;
    align-items: center;
    border-bottom: 1px solid rgba(255,255,255,0.1);
    padding: 0.4rem 0;
    margin-bottom: 0;
  }

  .parts-list td {
    display: block !important;
    padding: 0 !important;
    text-align: left !important;
    border: none !important;
  }

  .parts-list td:before {
    display: none !important;
  }

  .col-checkbox {
    grid-area: chk;
    text-align: center;
  }

  .col-img {
    grid-area: img;
    align-self: center;
  }
  
  .list-thumb {
    width: 46px;
    height: 46px;
    margin-bottom: 0;
    border-radius: 6px;
  }

  .col-name {
    grid-area: name;
    align-self: end;
    min-width: 0;
  }

  .name-cell {
    align-items: flex-start;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .name-row {
    flex-wrap: nowrap;
    overflow: hidden;
  }

  .name-cell .part-name {
    font-size: 0.95rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tags-container {
    margin-bottom: 0;
  }

  .small-tag-pill {
    padding: 0 0.4rem;
    font-size: 0.7rem;
  }

  .part-desc {
    display: none; /* Hide description on mobile to save vertical space */
  }

  .col-loc-header {
    display: none !important;
  }

  .col-loc {
    grid-area: loc;
    align-self: start;
    font-size: 0.75rem;
    color: rgba(255,255,255,0.4); /* Thin faint text below */
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: -0.1rem;
  }

  .parts-list td:nth-of-type(6) {
    grid-area: qty;
    display: flex;
    align-items: center;
  }
  
  .parts-list td:nth-of-type(7) {
    grid-area: action;
    display: flex;
    justify-content: flex-start;
  }
  
  .hide-on-mobile,
  .parts-list td.hide-on-mobile,
  .parts-list th.hide-on-mobile {
     display: none !important;
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

.hover-image-preview {
    position: fixed;
    z-index: 2500;
    width: 360px;
    padding: 0.75rem;
    border-radius: 14px;
    background: rgba(15, 23, 42, 0.96);
    border: 1px solid rgba(148, 163, 184, 0.35);
    box-shadow: 0 18px 40px rgba(0, 0, 0, 0.45);
    pointer-events: none;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    backdrop-filter: blur(8px);
}

.hover-image-preview img {
    width: 100%;
    height: 300px;
    object-fit: contain;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.04);
}

.hover-image-preview span {
    font-size: 0.85rem;
    color: var(--text-primary);
    line-height: 1.35;
    word-break: break-word;
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
    justify-content: center;
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

/* スケルトンローディングアニメーション */
.skeleton-pulse {
  background: linear-gradient(90deg, rgba(255,255,255,0.05) 25%, rgba(255,255,255,0.15) 50%, rgba(255,255,255,0.05) 75%);
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s infinite;
  border-radius: 4px;
}

@keyframes skeleton-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
</style>
