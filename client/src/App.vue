<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import PartsList from './components/PartsList.vue';
import PartForm from './components/PartForm.vue';
import DataManagement from './components/DataManagement.vue';
import MasterDataManagement from './components/MasterDataManagement.vue';
import LocationGridView from './components/LocationGridView.vue';
import UsedPartsView from './components/UsedPartsView.vue';
import QrScanner from './components/QrScanner.vue';
import QrGenerator from './components/QrGenerator.vue';

import api from './api';

const showModal = ref(false);
const showDataModal = ref(false);
const showMasterModal = ref(false);
const showQrGenerator = ref(false);
const showDropdown = ref(false);
const editingPart = ref(null);
const partsListKey = ref(0);
const partsListRef = ref(null);

// ハッシュルーティング（#/qr でQR画面表示）
const currentPage = ref(window.location.hash === '#/qr' ? 'qr' : 'main');
const onHashChange = () => {
    currentPage.value = window.location.hash === '#/qr' ? 'qr' : 'main';
};

// Close dropdown when clicked outside
const closeDropdown = (e) => {
  if (!e.target.closest('.dropdown-container')) {
    showDropdown.value = false;
  }
};
onMounted(() => {
  window.addEventListener('hashchange', onHashChange);
  document.addEventListener('click', closeDropdown);
});
onUnmounted(() => {
  window.removeEventListener('hashchange', onHashChange);
  document.removeEventListener('click', closeDropdown);
});

const currentView = ref('parts'); // 'parts' | 'used-parts' | 'locations'
const targetLocationId = ref('');

// Mobile detection
const isMobile = ref(/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent));
const cameraInput = ref(null);

const openAddModal = () => {
  editingPart.value = null;
  showModal.value = true;
};

const openEditModal = (part) => {
  editingPart.value = part;
  showModal.value = true;
};

const closeModal = () => {
  showModal.value = false;
  editingPart.value = null;
};

const editingMasterLocationId = ref(null);

const openMasterModal = (location = null) => {
    if (location && location.id) {
        editingMasterLocationId.value = location.id;
    } else {
        editingMasterLocationId.value = null;
    }
    showMasterModal.value = true;
};

const closeMasterModal = () => {
    showMasterModal.value = false;
    editingMasterLocationId.value = null;
};

const handleSaved = () => {
  if (partsListRef.value && partsListRef.value.fetchParts) {
      partsListRef.value.fetchParts();
  } else {
      partsListKey.value++; // Force refresh list fallback
  }
};

const handleLocationSelect = (id) => {
    targetLocationId.value = id;
    currentView.value = 'parts';
    partsListKey.value++; // Force remount to apply prop
};

const switchView = (view) => {
    currentView.value = view;
    if (view === 'parts') targetLocationId.value = ''; // Reset filter when manually switching
};

const handleCameraClick = () => {
    cameraInput.value.click();
};

const onCameraFileChange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    try {
        const now = new Date();
        const timestamp = now.toLocaleString('ja-JP', { 
            year: 'numeric', 
            month: '2-digit', 
            day: '2-digit', 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        const formData = new FormData();
        formData.append('name', `(カメラ登録) ${timestamp}`);
        formData.append('quantity', 1);
        formData.append('image', file);

        const res = await api.post('/parts', formData);
        
        // Refresh list
        if (partsListRef.value && partsListRef.value.fetchParts) {
            partsListRef.value.fetchParts();
        } else {
            partsListKey.value++;
        }
        
        // Open edit modal for the new part
        // We need to fetch the full part data or construct it. The API returns id, name, etc.
        // Let's assume response contains the ID.
        if (res.data && res.data.id) {
             // Fetch full details to be safe or use returned data
             const partRes = await api.get(`/parts?search=${res.data.id}`); // This might not be efficient way to get by ID, but parts list logic uses filters.
             // Actually, simplest is to just open edit with what we have + new.
             // But PartForm expects full object. Let's just pass what we know + ID.
             // Better: GET /parts/:id but we don't have that endpoint implemented in plan?
             // Checking routes/parts.js -> It has GET / but no GET /:id. The GET / returns all.
             // Filters work. Let's try to pass constructed object.
             
             const newPart = {
                 id: res.data.id,
                 name: res.data.name,
                 image_path: res.data.image_path,
                 quantity: 1,
                 tags: [],
                 category_id: null,
                 location_id: null,
                 description: ''
             };
             
             editingPart.value = newPart;
             showModal.value = true;
        }



    } catch (err) {
        console.error(err);
        alert('登録に失敗しました');
    } finally {
        event.target.value = ''; // Reset input
    }
};
</script>

<template>
  <!-- QRスキャン画面 -->
  <QrScanner v-if="currentPage === 'qr'" />

  <!-- メイン画面 -->
  <div v-else class="app-container">
    <header class="main-header glass-panel">
      <div class="container header-content">
        <h1 class="logo">
          <span class="icon">⚡️</span>
          <span class="text title-gradient">電子パーツ管理</span>
        </h1>
        
        <div class="view-switcher">
            <button 
                class="btn-tab" 
                :class="{ active: currentView === 'parts' }" 
                @click="switchView('parts')"
            >
                📋 全パーツ
            </button>
            <button 
                class="btn-tab" 
                :class="{ active: currentView === 'used-parts' }" 
                @click="switchView('used-parts')"
            >
                🧩 使用済み
            </button>
            <button 
                class="btn-tab" 
                :class="{ active: currentView === 'locations' }" 
                @click="switchView('locations')"
            >
                🗄️ 保管庫ビュー
            </button>
        </div>

        <nav class="nav-actions">
          <input 
            type="file" 
            ref="cameraInput" 
            accept="image/*" 
            capture="environment" 
            class="hidden-input" 
            @change="onCameraFileChange"
          />
          <button v-if="currentView === 'parts'" class="btn btn-outline btn-sm camera-btn" @click="handleCameraClick">
            📷 {{ isMobile ? 'カメラで追加' : '画像から追加' }}
          </button>
          <a href="#/qr" class="btn btn-outline btn-sm qr-link">📦 QR入出庫</a>
          
          <div class="dropdown-container">
            <button class="btn btn-outline btn-sm" @click="showDropdown = !showDropdown">
              ⚙️ 設定 ▾
            </button>
            <div class="dropdown-menu glass-panel" v-if="showDropdown">
              <button class="dropdown-item" @click="showQrGenerator = true; showDropdown = false">🖨️ QR印刷</button>
              <button class="dropdown-item" @click="openMasterModal(); showDropdown = false">⚙️ マスタ管理</button>
              <button class="dropdown-item" @click="showDataModal = true; showDropdown = false">📂 データ管理</button>
            </div>
          </div>

          <button v-if="currentView === 'parts'" class="btn btn-primary" @click="openAddModal">+ パーツ追加</button>
        </nav>
      </div>
    </header>

    <main class="container main-content">
      <template v-if="currentView === 'parts'">
          <PartsList 
            ref="partsListRef"
            :key="partsListKey" 
            :initialLocationId="targetLocationId"
            @add="openAddModal" 
            @edit="openEditModal" 
          />
      </template>
      <template v-else-if="currentView === 'used-parts'">
          <UsedPartsView
            ref="partsListRef"
            @edit="openEditModal"
          />
      </template>
      <template v-else>
          <LocationGridView 
            @select="handleLocationSelect" 
            @edit-location="openMasterModal"
            @edit-part="openEditModal"
          />
      </template>
    </main>

    <PartForm 
      v-if="showModal" 
      :part="editingPart" 
      @close="closeModal" 
      @saved="handleSaved" 
    />
    
    <DataManagement
      v-if="showDataModal"
      @close="showDataModal = false"
    />

    <MasterDataManagement
      v-if="showMasterModal"
      :initialLocationEditId="editingMasterLocationId"
      @close="closeMasterModal"
    />

    <QrGenerator
      v-if="showQrGenerator"
      @close="showQrGenerator = false"
    />
  </div>
</template>

<style scoped>
.nav-actions {
  display: flex;
  gap: 1rem;
  align-items: center;
}

.btn-sm {
  padding: 0.5rem 1rem;
  font-size: 0.9rem;
}
.btn-outline {
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-primary);
}
.btn-outline:hover {
  border-color: var(--accent-color);
}

.dropdown-container {
  position: relative;
  display: inline-block;
}

.dropdown-menu {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 0.5rem;
  background: #1e293b;
  min-width: 160px;
  border-radius: 8px;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.5), 0 2px 4px -1px rgba(0, 0, 0, 0.4);
  z-index: 200;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.dropdown-item {
  padding: 0.75rem 1rem;
  background: transparent;
  border: none;
  color: var(--text-primary);
  text-align: left;
  font-size: 0.95rem;
  cursor: pointer;
  transition: background-color 0.2s;
}

.dropdown-item:hover {
  background: rgba(255, 255, 255, 0.1);
}

.app-container {
  min-height: 100vh;
  padding-bottom: 2rem;
}

.main-header {
  position: sticky;
  top: 1rem;
  margin: 1rem;
  z-index: 100;
}

.header-content {
  height: 70px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.logo {
  font-size: 1.5rem;
  font-weight: 800;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.main-content {
  margin-top: 2rem;
}

@media (max-width: 768px) {
  .main-header {
    position: static;
    margin: 0;
    border-radius: 0;
    border-top: none;
    border-left: none;
    border-right: none;
  }
  
  .header-content {
    height: auto;
    flex-direction: column;
    padding: 1rem 0;
    gap: 1rem;
  }

  .nav-actions {
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.5rem;
  }
}

.view-switcher {
    display: flex;
    background: rgba(0,0,0,0.2);
    padding: 0.25rem;
    border-radius: 8px;
    gap: 0.5rem;
}

.btn-tab {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    padding: 0.5rem 1rem;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
    transition: all 0.2s;
}

.btn-tab:hover {
    color: white;
    background: rgba(255,255,255,0.05);
}

.btn-tab.active {
    background: var(--accent-color);
    color: white;
    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
}

.hidden-input {
    display: none;
}

.qr-link {
    background: rgba(245, 158, 11, 0.15) !important;
    border-color: rgba(245, 158, 11, 0.4) !important;
    color: #f59e0b !important;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
}
.qr-link:hover {
    background: rgba(245, 158, 11, 0.25) !important;
    border-color: #f59e0b !important;
}
</style>
