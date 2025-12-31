<script setup>
import { ref, onMounted, computed } from 'vue';
import api from '../api';

const emit = defineEmits(['select']);

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
            @click="selectLocation(loc.id)"
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
            </div>
        </div>
    </div>
  </div>
</template>

<style scoped>
.location-grid-container {
    padding: 1rem;
    height: 100%;
    overflow-y: auto;
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
    padding-bottom: 2rem;
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

.loading {
    text-align: center;
    padding: 2rem;
    color: var(--text-secondary);
}
</style>
