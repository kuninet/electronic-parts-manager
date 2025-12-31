<script setup>
import { ref } from 'vue';
import PartsList from './components/PartsList.vue';
import PartForm from './components/PartForm.vue';
import DataManagement from './components/DataManagement.vue';
import MasterDataManagement from './components/MasterDataManagement.vue';
import LocationGridView from './components/LocationGridView.vue';

const showModal = ref(false);
const showDataModal = ref(false);
const showMasterModal = ref(false);
const editingPart = ref(null);
const partsListKey = ref(0);

const currentView = ref('parts'); // 'parts' or 'locations'
const targetLocationId = ref('');

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

const handleSaved = () => {
  partsListKey.value++; // Force refresh list
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
</script>

<template>
  <div class="app-container">
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
                :class="{ active: currentView === 'locations' }" 
                @click="switchView('locations')"
            >
                🗄️ 保管庫ビュー
            </button>
        </div>

        <nav class="nav-actions">
          <button class="btn btn-outline btn-sm" @click="showMasterModal = true">⚙️ マスタ管理</button>
          <button class="btn btn-outline btn-sm" @click="showDataModal = true">📂 データ管理</button>
          <button class="btn btn-primary" @click="openAddModal">+ パーツ追加</button>
        </nav>
      </div>
    </header>

    <main class="container main-content">
      <template v-if="currentView === 'parts'">
          <PartsList 
            :key="partsListKey" 
            :initialLocationId="targetLocationId"
            @add="openAddModal" 
            @edit="openEditModal" 
          />
      </template>
      <template v-else>
          <LocationGridView @select="handleLocationSelect" />
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
      @close="showMasterModal = false"
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
</style>
