<script setup>
import { ref, nextTick, onMounted, onUnmounted } from 'vue';
import PartsList from './components/PartsList.vue';
import PartForm from './components/PartForm.vue';
import DataManagement from './components/DataManagement.vue';
import MasterDataManagement from './components/MasterDataManagement.vue';
import LocationGridView from './components/LocationGridView.vue';
import UsedPartsView from './components/UsedPartsView.vue';
import QrScanner from './components/QrScanner.vue';
import QrGenerator from './components/QrGenerator.vue';
import AiSuggestionReviewModal from './components/AiSuggestionReviewModal.vue';
import PhotoLightboxModal from './components/PhotoLightboxModal.vue';
import ToastHost from './components/ToastHost.vue';

import AppSidebar from './components/layout/AppSidebar.vue';
import AppTopBar from './components/layout/AppTopBar.vue';
import MobileTabBar from './components/layout/MobileTabBar.vue';
import CameraFab from './components/layout/CameraFab.vue';
import MobileMoreSheet from './components/layout/MobileMoreSheet.vue';

import api from './api';
import { resizeImageFile } from './utils/imageResize';
import { hasPreviewablePhoto } from './utils/photoPreview';
import { useToast } from './composables/useToast';
import { usePartsStats } from './composables/usePartsStats';
import { usePartsFilters } from './composables/usePartsFilters';
import { useShortcuts } from './composables/useShortcuts';

const toast = useToast();
const stats = usePartsStats();
const filters = usePartsFilters();

const showModal = ref(false);
const showDataModal = ref(false);
const showMasterModal = ref(false);
const showQrGenerator = ref(false);
const showAiReview = ref(false);
const showMoreSheet = ref(false);
const editingPart = ref(null);
const previewPart = ref(null);
const editingMasterLocationId = ref(null);

const partsListRef = ref(null);
const topBarRef = ref(null);
const cameraInput = ref(null);
const uploadingCameraFile = ref(false);

const currentView = ref('parts'); // 'parts' | 'used-parts' | 'locations'

// ハッシュルーティング（#/qr でQR画面表示）
const currentPage = ref(window.location.hash === '#/qr' ? 'qr' : 'main');
const onHashChange = () => {
  currentPage.value = window.location.hash === '#/qr' ? 'qr' : 'main';
};

onMounted(() => {
  window.addEventListener('hashchange', onHashChange);
  stats.refreshNow();
});

onUnmounted(() => {
  window.removeEventListener('hashchange', onHashChange);
});

const switchView = (view) => {
  previewPart.value = null;
  currentView.value = view;
};

// QR 画面（#/qr）からメイン画面へ戻る
const leaveQrPage = () => {
  if (currentPage.value !== 'qr') return;
  window.location.hash = '#/';
  currentPage.value = 'main'; // hashchange を待たずに切り替える
};

const onTabNavigate = (view) => {
  leaveQrPage();
  switchView(view);
};

const onTabMore = () => {
  leaveQrPage();
  showMoreSheet.value = true;
};

const handleLocationSelect = (id) => {
  filters.locationId.value = String(id);
  switchView('parts');
};

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

const openPhotoPreview = (part) => {
  if (!hasPreviewablePhoto(part)) {
    openEditModal(part);
    return;
  }
  previewPart.value = part;
};

const closePhotoPreview = () => {
  previewPart.value = null;
};

const onPreviewEdit = (part) => {
  previewPart.value = null;
  openEditModal(part);
};

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
  partsListRef.value?.fetchParts?.();
  stats.refresh();
};

const onAiReviewClosed = () => {
  showAiReview.value = false;
  partsListRef.value?.fetchParts?.();
  stats.refresh();
};

const onAiReviewUpdated = () => {
  stats.refresh();
};

const handleSearchFocus = () => {
  switchView('parts');
  nextTick(() => {
    topBarRef.value?.focusSearch();
  });
};

useShortcuts({
  onSearch: handleSearchFocus,
  onNew: openAddModal,
  isBlocked: () =>
    !!previewPart.value ||
    showModal.value ||
    showDataModal.value ||
    showMasterModal.value ||
    showQrGenerator.value ||
    showAiReview.value ||
    showMoreSheet.value
});

const handleCameraClick = () => {
  if (uploadingCameraFile.value) return;
  cameraInput.value.click();
};

const onCameraFileChange = async (event) => {
  const file = event.target.files?.[0];
  if (!file || uploadingCameraFile.value) return;

  uploadingCameraFile.value = true;
  try {
    const processedFile = await resizeImageFile(file);

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
    formData.append('image', processedFile);

    const res = await api.post('/parts', formData);

    partsListRef.value?.fetchParts?.();
    stats.refresh();

    if (res.data && res.data.id) {
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

    toast.success('カメラから部品を登録しました');
  } catch (err) {
    console.error(err);
    toast.error('登録に失敗しました');
  } finally {
    uploadingCameraFile.value = false;
    event.target.value = '';
  }
};
</script>

<template>
  <QrScanner v-if="currentPage === 'qr'" />

  <div v-else class="app-shell">
    <AppSidebar
      class="only-desktop"
      :current-view="currentView"
      @navigate="switchView"
      @search="handleSearchFocus"
      @open-ai-review="showAiReview = true"
      @open-qr-print="showQrGenerator = true"
      @open-master="openMasterModal()"
      @open-data="showDataModal = true"
    />

    <div class="app-main">
      <AppTopBar
        ref="topBarRef"
        :current-view="currentView"
        :uploading="uploadingCameraFile"
        @add="openAddModal"
        @camera="handleCameraClick"
      />

      <main class="app-content">
        <PartsList
          v-if="currentView === 'parts'"
          ref="partsListRef"
          @add="openAddModal"
          @edit="openEditModal"
          @preview="openPhotoPreview"
          @open-ai-review="showAiReview = true"
        />
        <UsedPartsView
          v-else-if="currentView === 'used-parts'"
          ref="partsListRef"
          @edit="openEditModal"
        />
        <LocationGridView
          v-else
          @select="handleLocationSelect"
          @edit-location="openMasterModal"
          @edit-part="openEditModal"
        />
      </main>
    </div>

    <CameraFab
      v-if="currentView === 'parts'"
      class="only-mobile"
      :uploading="uploadingCameraFile"
      @click="handleCameraClick"
    />

    <MobileMoreSheet
      v-if="showMoreSheet"
      @close="showMoreSheet = false"
      @open-ai-review="showAiReview = true"
      @open-qr-print="showQrGenerator = true"
      @open-master="openMasterModal()"
      @open-data="showDataModal = true"
      @add="openAddModal"
    />

    <input
      type="file"
      ref="cameraInput"
      accept="image/*"
      capture="environment"
      class="hidden-input"
      :disabled="uploadingCameraFile"
      @change="onCameraFileChange"
    />

    <AiSuggestionReviewModal
      v-if="showAiReview"
      @close="onAiReviewClosed"
      @updated="onAiReviewUpdated"
    />

    <PhotoLightboxModal
      v-if="previewPart"
      :part="previewPart"
      @close="closePhotoPreview"
      @edit="onPreviewEdit"
    />

    <PartForm
      v-if="showModal"
      :part="editingPart"
      @close="closeModal"
      @saved="handleSaved"
      @deleted="handleSaved"
      @restored="handleSaved"
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

  <MobileTabBar
    class="only-mobile"
    :current-view="currentPage === 'qr' ? 'qr' : currentView"
    @navigate="onTabNavigate"
    @more="onTabMore"
  />

  <ToastHost />
</template>
