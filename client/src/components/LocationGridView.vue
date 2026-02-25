<script setup>
import { ref, onMounted, computed } from 'vue';
import api from '../api';

const emit = defineEmits(['select', 'edit-location', 'edit-part']);

const locations = ref([]);
const loading = ref(true);
const searchQuery = ref('');

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

const selectLocation = (id) => {
    emit('select', id);
};

// Preview Modal Logic
const previewLocation = ref(null);
const previewParts = ref([]);
const loadingPreview = ref(false);

const openPreview = async (loc) => {
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
            @click="openPreview(loc)"
        >
            <div class="card-image">
                <img v-if="loc.image_path" :src="`${api.defaults.baseURL.replace('/api', '')}${loc.image_path}`" />
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
    padding: 1rem;
    height: 100%;
    overflow-y: auto; /* Enable scrolling */
    display: flex;
    flex-direction: column;
}

.toolbar {
    margin-bottom: 1.5rem;
}

.search-input {
    width: 100%;
    max-width: 400px;
    padding: 0.8rem 1rem;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    background: rgba(255, 255, 255, 0.05);
    color: white;
    font-size: 1rem;
}
.search-input:focus {
    outline: none;
    border-color: var(--accent-color);
    background: rgba(255, 255, 255, 0.1);
}

.grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 2rem;
    padding-bottom: 100px; /* Space for scrolling */
}

.card {
    background: rgba(30, 41, 59, 0.7);
    border: 1px solid var(--border-color);
    border-radius: 16px;
    overflow: hidden;
    cursor: pointer;
    transition: transform 0.2s, box-shadow 0.2s, background 0.2s;
    display: flex;
    flex-direction: column;
}

.card:hover {
    transform: translateY(-4px);
    box-shadow: 0 12px 24px rgba(0,0,0,0.4);
    border-color: var(--accent-color);
    background: rgba(30, 41, 59, 0.9);
}

.card-image {
    height: 200px;
    background: rgba(0,0,0,0.2);
    display: flex;
    align-items: center;
    justify-content: center;
    border-bottom: 1px solid var(--border-color);
}

.card-image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.placeholder {
    font-size: 3rem;
    opacity: 0.5;
}

.card-content {
    padding: 1rem;
}

.card-content h3 {
    margin: 0 0 0.5rem 0;
    font-size: 1.1rem;
    color: var(--text-primary);
}

.card-content p {
    margin: 0;
    font-size: 0.9rem;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.card-stats {
    margin-top: 0.5rem;
    color: var(--text-secondary);
    font-size: 0.8rem;
    text-align: right;
}

.loading {
    text-align: center;
    padding: 2rem;
    color: var(--text-secondary);
}

/* Modal Styles */
.modal-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.8);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 2000;
  padding: 1rem;
}

.modal-content {
  background: #1e293b;
  border-radius: 12px;
  width: 100%;
  max-width: 600px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-color);
  box-shadow: 0 20px 50px rgba(0,0,0,0.5);
}

.modal-header {
    padding: 1rem 1.5rem;
    border-bottom: 1px solid var(--border-color);
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.modal-header h2 {
    margin: 0;
    font-size: 1.25rem;
    color: var(--text-primary);
}

.close-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: 1.5rem;
    cursor: pointer;
    line-height: 1;
}

.modal-body {
    padding: 1.5rem;
    overflow-y: auto;
}

.loc-summary {
    display: flex;
    gap: 1rem;
    margin-bottom: 1.5rem;
    align-items: center;
    background: rgba(255,255,255,0.03);
    padding: 1rem;
    border-radius: 8px;
}

.preview-loc-img {
    width: 60px;
    height: 60px;
    object-fit: cover;
    border-radius: 8px;
    border: 1px solid var(--border-color);
}

.description {
    color: var(--text-secondary);
    font-size: 0.95rem;
}

.preview-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 1rem;
}

.preview-item {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.5rem;
    background: rgba(255,255,255,0.05);
    border-radius: 6px;
}

.part-thumb {
    width: 40px;
    height: 40px;
    object-fit: cover;
    border-radius: 4px;
}

.part-thumb-placeholder {
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255,255,255,0.1);
    border-radius: 4px;
    font-size: 1.2rem;
}

.part-details {
    display: flex;
    flex-direction: column;
    flex: 1;
}

.part-name {
    font-weight: bold;
    font-size: 0.95rem;
}

.part-qty {
    font-size: 0.85rem;
    color: var(--text-secondary);
}

.modal-footer {
    padding: 1rem 1.5rem;
    border-top: 1px solid var(--border-color);
    display: flex;
    justify-content: flex-end;
    gap: 1rem;
}

.clickable-item {
    cursor: pointer;
    transition: background 0.2s;
}
.clickable-item:hover {
    background: rgba(255, 255, 255, 0.1);
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
    margin-top: 0.2rem;
    width: fit-content;
}
.loc-info-text {
    display: flex;
    flex-direction: column;
    justify-content: center;
}
</style>
