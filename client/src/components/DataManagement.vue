<script setup>
import { ref } from 'vue';
import api from '../api';

const emit = defineEmits(['close']);

const importing = ref(false);
const importMessage = ref('');
const importError = ref('');

const downloadCsv = async () => {
  try {
    const response = await api.get('/backup/export/csv', { responseType: 'blob' });
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `parts_backup_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch (err) {
    console.error('Export failed', err);
    alert('Export failed');
  }
};

const handleImport = async (event, type) => {
  const file = event.target.files[0];
  if (!file) return;

  if (!confirm(`本当に ${type} をインポートしますか? 既存のデータが上書きされる可能性があります。`)) {
    event.target.value = '';
    return;
  }

  importing.value = true;
  importMessage.value = '';
  importError.value = '';

  const formData = new FormData();
  formData.append('file', file);

  try {
    const endpoint = type === 'csv' ? '/backup/import/csv' : '/backup/import/excel';
    const res = await api.post(endpoint, formData);
    importMessage.value = res.data.message;
  } catch (err) {
    console.error('Import failed', err);
    importError.value = err.response?.data?.error || 'Import failed';
  } finally {
    importing.value = false;
    event.target.value = '';
  }
};
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-content glass-panel">
      <h2>データ管理</h2>

      <div class="data-section">
        <h3>バックアップ (エクスポート)</h3>
        <p>在庫データのフルバックアップ(CSV)をダウンロードします。</p>
        <button class="btn btn-primary" @click="downloadCsv">
          CSV ダウンロード
        </button>
      </div>

      <div class="divider"></div>

      <div class="data-section">
        <h3>リストア / インポート</h3>
        <p>CSVまたはExcelからデータを取り込みます。注意: データベースが変更される可能性があります。</p>
        
        <div class="import-actions">
          <div class="import-group">
            <label class="btn btn-outline">
              CSV インポート (リストア)
              <input type="file" accept=".csv" class="hidden-input" @change="e => handleImport(e, 'csv')" :disabled="importing">
            </label>
          </div>
          
          <div class="import-group">
            <label class="btn btn-outline">
              Excel インポート
              <input type="file" accept=".xlsx, .xls" class="hidden-input" @change="e => handleImport(e, 'excel')" :disabled="importing">
            </label>
          </div>
        </div>

        <div v-if="importing" class="status-msg">インポート中...</div>
        <div v-if="importMessage" class="status-msg success">{{ importMessage }}</div>
        <div v-if="importError" class="status-msg error">{{ importError }}</div>
      </div>

      <div class="footer">
        <button class="btn" @click="$emit('close')">閉じる</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.7);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.modal-content {
  background: #1e293b;
  padding: 2rem;
  width: 100%;
  max-width: 500px;
  position: relative;
}

h2 {
  margin-bottom: 2rem;
  color: var(--accent-color);
}

h3 {
  margin-bottom: 0.5rem;
  font-size: 1.1rem;
}

p {
  color: var(--text-secondary);
  margin-bottom: 1rem;
  font-size: 0.9rem;
}

.data-section {
  margin-bottom: 1.5rem;
}

.divider {
  height: 1px;
  background: var(--border-color);
  margin: 1.5rem 0;
}

.import-actions {
  display: flex;
  gap: 1rem;
}

.btn-outline {
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-primary);
  display: inline-block;
  cursor: pointer;
  padding: 0.75rem 1.5rem;
  border-radius: 8px;
  font-weight: 600;
}

.btn-outline:hover {
  border-color: var(--accent-color);
  background: rgba(255,255,255,0.05);
}

.hidden-input {
  display: none;
}

.status-msg {
  margin-top: 1rem;
  padding: 0.5rem;
  border-radius: 4px;
  background: rgba(0,0,0,0.2);
}

.status-msg.success { color: var(--success); }
.status-msg.error { color: var(--danger); }

.footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 2rem;
}
</style>
