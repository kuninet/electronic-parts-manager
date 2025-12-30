<script setup>
import { ref } from 'vue';
import PartsList from './components/PartsList.vue';
import PartForm from './components/PartForm.vue';
import DataManagement from './components/DataManagement.vue';
import MasterDataManagement from './components/MasterDataManagement.vue';

const showModal = ref(false);
const showDataModal = ref(false);
const showMasterModal = ref(false);
const editingPart = ref(null);
const partsListKey = ref(0);

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
</script>

<template>
  <div class="app-container">
    <header class="main-header glass-panel">
      <div class="container header-content">
        <h1 class="logo">
          <span class="icon">⚡️</span>
          <span class="text title-gradient">電子パーツ管理</span>
        </h1>
        <nav class="nav-actions">
          <button class="btn btn-outline btn-sm" @click="showMasterModal = true">⚙️ マスタ管理</button>
          <button class="btn btn-outline btn-sm" @click="showDataModal = true">📂 データ管理</button>
          <button class="btn btn-primary" @click="openAddModal">+ パーツ追加</button>
        </nav>
      </div>
    </header>

    <main class="container main-content">
      <PartsList :key="partsListKey" @add="openAddModal" @edit="openEditModal" />
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
/* ... (existing styles) */

<style scoped>
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
</style>
