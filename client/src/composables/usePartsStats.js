import { ref } from 'vue';
import api from '../api';

const stats = ref(null);
let debounceTimer = null;

async function fetchStats() {
  try {
    const res = await api.get('/parts/stats');
    stats.value = res.data;
  } catch (err) {
    console.error('Failed to fetch parts stats:', err);
  }
}

export function usePartsStats() {
  const refresh = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      fetchStats();
    }, 1000);
  };

  const refreshNow = () => {
    clearTimeout(debounceTimer);
    fetchStats();
  };

  return {
    stats,
    refresh,
    refreshNow
  };
}
