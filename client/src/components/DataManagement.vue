<script setup>
import { ref } from 'vue';
import api from '../api';

const emit = defineEmits(['close']);

const importing = ref(false);
const importMessage = ref('');
const importError = ref('');

const downloadFull = async () => {
  try {
    const response = await api.get('/backup/export/full', { responseType: 'blob' });
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `full_backup_${new Date().toISOString().split('T')[0]}.zip`);
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch (err) {
    console.error('Export failed', err);
    alert('Export failed');
  }
};

const handleFullImport = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (!confirm('【警告】フルバックアップから復元しますか？\n\n現在のデータは全て上書きされ、元に戻せません。\nよろしいですか？')) {
        event.target.value = '';
        return;
    }

    importing.value = true;
    importError.value = '';
    
    const formData = new FormData();
    formData.append('file', file);

    try {
        await api.post('/backup/import/full', formData);
        alert('復元が完了しました。ページをリロードします。');
        window.location.reload();
    } catch (err) {
        console.error('Full import failed', err);
        importError.value = err.response?.data?.error || 'Restore failed';
        alert('復元に失敗しました');
    } finally {
        importing.value = false;
        event.target.value = '';
    }
};


const handleReset = async () => {
    if (!confirm('本当に全てのデータを削除しますか？\nこの操作は取り消せません。\n(カテゴリや場所のマスタは保持されます)')) {
        return;
    }

    const userInput = prompt('確認のため "delete" と入力してください');
    if (userInput !== 'delete') {
        alert('入力が一致しません。操作をキャンセルしました。');
        return;
    }

    try {
        await api.post('/backup/reset');
        alert('全てのデータを削除しました。');
        emit('close');
        window.location.reload(); // Refresh to clear lists
    } catch (err) {
        console.error('Reset failed', err);
        alert('削除に失敗しました: ' + (err.response?.data?.error || err.message));
    }
};
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-content glass-panel">
      <h2>データ管理</h2>

      <div class="data-section">
        <h3>システム完全バックアップ (ZIP)</h3>
        <p>画像・PDF・すべてのデータをまとめて保存・復元します。基本はこちらを使用してください。</p>
        
        <div class="backup-actions">
             <button class="btn btn-primary" @click="downloadFull">
              📦 フルバックアップをダウンロード
            </button>
            
            <label class="btn btn-outline hover-danger">
              📥 バックアップから復元
              <input type="file" accept=".zip" class="hidden-input" @change="e => handleFullImport(e)" :disabled="importing">
            </label>
        </div>
      </div>

      
      <div class="data-section danger-zone">
        <h3>🗑️ 危険な操作</h3>
        <p>登録された全パーツデータ・タグ紐付け・画像・PDFを完全に削除します。<br>(カテゴリ・保管場所・タグのマスタデータは残ります)</p>
        <button class="btn btn-danger" @click="handleReset">
          全データを削除する
        </button>
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
  max-height: 90vh; /* Handle small screens */
  overflow-y: auto;
  position: relative;
}

.danger-zone {
    border: 1px solid var(--danger);
    padding: 1rem;
    border-radius: 8px;
    background: rgba(220, 38, 38, 0.1);
}

.danger-zone h3 {
    color: var(--danger);
}

h2 {
  margin-bottom: 2rem;
  color: var(--accent-color);
}

h3 {
  margin-bottom: 0.5rem;
  font-size: 1.1rem;
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

.backup-actions {
    display: flex;
    gap: 1rem;
    margin-top: 1rem;
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
