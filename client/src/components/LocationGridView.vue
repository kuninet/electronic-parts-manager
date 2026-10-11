<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue';
import api from '../api';

const HOVER_PREVIEW_DELAY_MS = 1000;
const HOVER_PREVIEW_WIDTH = 540;
const HOVER_PREVIEW_HEIGHT = 500;
const emit = defineEmits(['select', 'edit-location', 'edit-part']);

const locations = ref([]);
const loading = ref(true);
const searchQuery = ref('');
const hoverPreview = ref({
    visible: false,
    imageSrc: '',
    name: '',
    top: 0,
    left: 0
});
let hoverPreviewTimer = null;

const filteredLocations = computed(() => {
    if (!searchQuery.value) return locations.value;
    const lower = searchQuery.value.toLowerCase();
    return locations.value.filter(loc => 
        loc.name.toLowerCase().includes(lower) || 
        (loc.description && loc.description.toLowerCase().includes(lower))
    );
});

const fetchLocations = async () => {
  loading.value = true;
  try {
    const res = await api.get('/locations');
    locations.value = res.data;
  } catch (err) {
    console.error(err);
  } finally {
    loading.value = false;
  }
};

onMounted(fetchLocations);
onUnmounted(() => {
    hideHoverPreview();
});

const selectLocation = (id) => {
    emit('select', id);
};

const supportsHoverPreview = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;

const resolveImageUrl = (imagePath) => {
    if (!imagePath) return '';
    if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) return imagePath;
    return `${api.defaults.baseURL.replace('/api', '')}${imagePath}`;
};

const clampHoverPreviewPosition = (rect) => {
    const margin = 16;
    const maxLeft = Math.max(margin, window.innerWidth - HOVER_PREVIEW_WIDTH - margin);
    const maxTop = Math.max(margin, window.innerHeight - HOVER_PREVIEW_HEIGHT - margin);
    const preferredLeft = rect.right - (HOVER_PREVIEW_WIDTH * 0.72);
    const preferredTop = rect.top - 36;

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

const scheduleHoverPreview = (event, loc) => {
    if (!supportsHoverPreview() || !loc.image_path) return;

    hideHoverPreview();
    const rect = event.currentTarget.getBoundingClientRect();
    hoverPreviewTimer = setTimeout(() => {
        const position = clampHoverPreviewPosition(rect);
        hoverPreview.value = {
            visible: true,
            imageSrc: resolveImageUrl(loc.image_path),
            name: loc.name,
            top: position.top,
            left: position.left
        };
        hoverPreviewTimer = null;
    }, HOVER_PREVIEW_DELAY_MS);
};

// Preview Modal Logic
const previewLocation = ref(null);
const previewParts = ref([]);
const loadingPreview = ref(false);

const openPreview = async (loc) => {
    hideHoverPreview();
    previewLocation.value = loc;
    loadingPreview.value = true;
    try {
        const res = await api.get('/parts', { params: { location_id: loc.id } });
        previewParts.value = res.data;
    } catch (err) {
        console.error(err);
        previewParts.value = [];
    } finally {
        loadingPreview.value = false;
    }
};

const closePreview = () => {
    previewLocation.value = null;
    previewParts.value = [];
};

const confirmSelection = () => {
    if (previewLocation.value) {
        selectLocation(previewLocation.value.id);
        closePreview();
    }
};

const handleEditLocation = (loc) => {
    emit('edit-location', loc);
    closePreview();
};

const handleEditPart = (part) => {
    emit('edit-part', part);
    closePreview();
};
</script>

<template>
  <div class="location-grid-container">
    <div class="toolbar">
        <input 
            v-model="searchQuery" 
            placeholder="🔍 保管場所を検索..." 
            class="search-input"
        />
    </div>

    <div v-if="loading" class="loading">Loading...</div>
    
    <div v-else class="grid">
        <div 
            v-for="loc in filteredLocations" 
            :key="loc.id" 
            class="card"
            @mouseenter="scheduleHoverPreview($event, loc)"
            @mouseleave="hideHoverPreview"
            @click="openPreview(loc)"
        >
            <div class="card-image">
                <img v-if="loc.image_path" :src="resolveImageUrl(loc.image_path)" />
                <div v-else class="placeholder">
                    📦
                </div>
            </div>
            <div class="card-content">
                <h3>{{ loc.name }}</h3>
                <p v-if="loc.description">{{ loc.description }}</p>
                <div class="card-stats">
                   <small>クリックして中身を確認</small>
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

    <!-- Preview Modal -->
    <div v-if="previewLocation" class="modal-overlay" @click.self="closePreview">
        <div class="modal-content glass-panel">
            <div class="modal-header">
                <h2>{{ previewLocation.name }}</h2>
                <button class="btn-icon close-btn" @click="closePreview">×</button>
            </div>
            
            <div class="modal-body">
                <div class="loc-summary clickable-item" @click="handleEditLocation(previewLocation)" title="保管庫を編集">
                    <img v-if="previewLocation.image_path" :src="`${api.defaults.baseURL.replace('/api', '')}${previewLocation.image_path}`" class="preview-loc-img" />
                    <div class="loc-info-text">
                        <p class="description">{{ previewLocation.description || '説明なし' }}</p>
                        <p v-if="previewLocation.qr_code" class="qr-code-badge">📱 {{ previewLocation.qr_code }}</p>
                    </div>
                </div>

                <h3>保管されているパーツ ({{ previewParts.length }})</h3>
                <div v-if="loadingPreview" class="loading-preview">読み込み中...</div>
                <div v-else-if="previewParts.length === 0" class="empty-state">
                    パーツは登録されていません
                </div>
                <div v-else class="preview-list">
                    <div v-for="part in previewParts" :key="part.id" class="preview-item clickable-item" @click="handleEditPart(part)" title="パーツを編集">
                        <img v-if="part.image_path" :src="part.image_path" class="part-thumb" />
                        <span v-else class="part-thumb-placeholder">⚡️</span>
                        <div class="part-details">
                            <span class="part-name">{{ part.name }}</span>
                            <span v-if="part.qr_code" class="qr-code-badge" style="margin-top: 2px;">📱 {{ part.qr_code }}</span>
                            <span class="part-qty">{{ part.quantity }} pcs</span>
                        </div>
                    </div>
                </div>
            </div>

            <div class="modal-footer">
                <button class="btn" @click="closePreview">閉じる</button>
                <button class="btn btn-primary" @click="confirmSelection">パーツ一覧を見る</button>
            </div>
        </div>
    </div>
  </div>
</template>

<style scoped>
.location-grid-container {
    padding: 16px 20px 32px;
    height: 100%;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
}

.toolbar {
    margin-bottom: var(--space-4);
}

.controls {
    margin-bottom: var(--space-4);
    display: flex;
    gap: var(--space-3);
}

.search-box {
    flex: 1;
    max-width: 440px;
}

.search-label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 32px;
    padding: 0 var(--space-2);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
}

.search-label:focus-within {
    border-color: var(--accent);
}

.search-icon {
    color: var(--text-3);
}

.search-input {
    flex: 1;
    height: 100%;
    border: none;
    background: transparent;
    color: var(--text);
    font-family: var(--font-sans);
    font-size: var(--fs-13);
    outline: none;
}

.search-input::placeholder {
    color: var(--text-3);
}

.grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: var(--space-3);
}

.card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
    cursor: pointer;
    transition: border-color var(--dur), box-shadow var(--dur);
    display: flex;
    flex-direction: column;
}

.card:hover {
    border-color: var(--border-strong);
    box-shadow: var(--shadow-md);
}

.hover-image-preview {
    position: fixed;
    z-index: 2500;
    width: 540px;
    padding: var(--space-3);
    border-radius: var(--radius-xl);
    background: var(--surface);
    border: 1px solid var(--border-strong);
    box-shadow: var(--shadow-lg);
    pointer-events: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.hover-image-preview img {
    width: 100%;
    height: 430px;
    object-fit: contain;
    border-radius: var(--radius-md);
    background: var(--surface-2);
}

.hover-image-preview span {
    font-size: var(--fs-12);
    color: var(--text);
    line-height: 1.35;
    word-break: break-word;
}

.card-image {
    height: 180px;
    background: var(--surface-2);
    display: flex;
    align-items: center;
    justify-content: center;
    border-bottom: 1px solid var(--border);
}

.card-image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.placeholder {
    color: var(--text-3);
    font-size: 2.5rem;
}

.card-content {
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    flex: 1;
}

.card-content h3 {
    margin: 0;
    font-size: var(--fs-14);
    font-weight: 600;
    color: var(--text);
}

.card-content p {
    margin: 0;
    font-size: var(--fs-12);
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.card-stats {
    margin-top: auto;
    padding-top: var(--space-2);
    color: var(--text-3);
    font-size: var(--fs-11);
    text-align: right;
}

.loading {
    text-align: center;
    padding: 40px 20px;
    color: var(--text-3);
}

/* Modal Styles */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 2000;
  padding: var(--space-4);
}

.modal-content {
  background: var(--surface);
  border-radius: var(--radius-xl);
  width: 100%;
  max-width: 600px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  box-shadow: var(--shadow-lg);
}

.modal-header {
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border);
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.modal-header h2 {
    margin: 0;
    font-size: var(--fs-16);
    font-weight: 600;
    color: var(--text);
}

.close-btn {
    background: none;
    border: none;
    color: var(--text-3);
    font-size: var(--fs-16);
    cursor: pointer;
    line-height: 1;
}

.close-btn:hover {
    color: var(--text);
}

.modal-body {
    padding: var(--space-4);
    overflow-y: auto;
}

.loc-summary {
    display: flex;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
    align-items: center;
    background: var(--surface-2);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
}

.preview-loc-img {
    width: 60px;
    height: 60px;
    object-fit: cover;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
}

.description {
    color: var(--text-2);
    font-size: var(--fs-13);
}

.preview-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-top: var(--space-3);
}

.preview-item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: background-color var(--dur);
}

.preview-item:hover {
    background: var(--surface-hover);
}

.part-thumb {
    width: 40px;
    height: 40px;
    object-fit: cover;
    border-radius: var(--radius-sm);
}

.part-thumb-placeholder {
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface);
    border-radius: var(--radius-sm);
    color: var(--text-3);
}

.part-details {
    display: flex;
    flex-direction: column;
    flex: 1;
}

.part-name {
    font-weight: 500;
    font-size: var(--fs-13);
    color: var(--text);
}

.part-qty {
    font-size: var(--fs-11);
    color: var(--text-3);
}

.modal-footer {
    padding: var(--space-3) var(--space-4);
    border-top: 1px solid var(--border);
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
}

.qr-code-badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: var(--fs-11);
    background: var(--surface-2);
    color: var(--text-2);
    padding: 1px 6px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    margin-top: 2px;
    width: fit-content;
}

.loc-info-text {
    display: flex;
    flex-direction: column;
    justify-content: center;
}
</style>
