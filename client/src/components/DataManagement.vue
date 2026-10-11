<script setup>
import { ref, onMounted } from 'vue';
import axios from 'axios';
import api from '../api';
import { useToast } from '../composables/useToast';

const toast = useToast();
const emit = defineEmits(['close']);

const importing = ref(false);
const importMessage = ref('');
const importError = ref('');
const s3Enabled = ref(false);

const exporting = ref(false);
const exportProgress = ref(0);
const exportMessage = ref('');
let exportPollTimer = null;

onMounted(async () => {
    try {
        const { data } = await api.get('/backup/config');
        s3Enabled.value = data.s3Enabled;
    } catch (err) {
        console.error('Failed to fetch backup config', err);
        s3Enabled.value = false;
    }
});

const downloadFull = async () => {
    try {
        const { data: config } = await api.get('/backup/config');
        if (config.s3Enabled) {
            exporting.value = true;
            exportProgress.value = 0;
            exportMessage.value = 'エクスポート開始中...';
            const { data } = await api.post('/backup/export/start');
            pollExportStatus(data.jobId);
        } else {
            // ローカル環境: blob方式
            const response = await api.get('/backup/export/full', { responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `full_backup_${new Date().toISOString().split('T')[0]}.zip`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            toast.success('バックアップファイルをダウンロードしました');
        }
    } catch (err) {
        console.error('Export failed', err);
        exporting.value = false;
        toast.error('エクスポートに失敗しました');
    }
};

const pollExportStatus = (jobId) => {
    exportPollTimer = setInterval(async () => {
        try {
            const { data } = await api.get(`/backup/export/status?jobId=${jobId}`);
            exportProgress.value = data.progress || 0;
            exportMessage.value = data.message || '';
            if (data.status === 'done') {
                clearInterval(exportPollTimer);
                exporting.value = false;
                const link = document.createElement('a');
                link.href = data.url;
                link.setAttribute('download', data.fileName);
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                toast.success('バックアップファイルをダウンロードしました');
            } else if (data.status === 'error') {
                clearInterval(exportPollTimer);
                exporting.value = false;
                toast.error('エクスポートに失敗しました: ' + data.message);
            }
        } catch (err) {
            clearInterval(exportPollTimer);
            exporting.value = false;
            toast.error('エクスポートステータスの取得に失敗しました');
        }
    }, 2000);
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
    importMessage.value = '準備中...';
    
    try {
        // S3が有効かつファイルが5MB以上の場合のみS3経由
        if (s3Enabled.value && file.size > 5 * 1024 * 1024) { 
            importMessage.value = 'アップロード用URLを取得中...';
            const { data: { url, key } } = await api.get('/backup/import/presigned-url', {
                params: { fileName: file.name }
            });
            
            importMessage.value = `AWS S3へアップロード中... (${(file.size / 1024 / 1024).toFixed(1)} MB)`;
            await axios.put(url, file, {
                headers: { 'Content-Type': 'application/zip' }
            });
            
            // Step 1: Download to EFS
            importMessage.value = 'サーバー(EFS)への転送を開始します...';
            await api.post('/backup/import/download', { key });
            
            // Step 2: Restore from EFS
            importMessage.value = 'DBリストアを実行中です。150MBを超える場合は1分程度かかることがあります...';
            await api.post('/backup/import/restore', { s3Key: key }, {
                timeout: 300000 // 5分 (API Gateway側で30秒で一旦切れる可能性はありますが、Lambda側は300秒動きます)
            });
        } else {
            // ローカル環境、または小規模ファイルの場合
            importMessage.value = file.size > 10 * 1024 * 1024 
                ? `サーバーへ直接アップロード中... (${(file.size / 1024 / 1024).toFixed(1)} MB)`
                : 'アップロード中...';
                
            const formData = new FormData();
            formData.append('file', file);
            await api.post('/backup/import/full', formData, {
                timeout: 300000 // 5分
            });
        }
        
        toast.success('復元が完了しました。ページを再読み込みします...');
        setTimeout(() => {
            window.location.reload();
        }, 1200);
    } catch (err) {
        console.error('Full import failed', err);
        importError.value = err.response?.data?.error || 'Restore failed';
        toast.error('復元に失敗しました: ' + importError.value);
    } finally {
        importing.value = false;
        importMessage.value = '';
        event.target.value = '';
    }
};


const handleReset = async () => {
    if (!confirm('本当に全てのデータを削除しますか？\nこの操作は取り消せません。\n(カテゴリや場所のマスタは保持されます)')) {
        return;
    }

    const userInput = prompt('確認のため "delete" と入力してください');
    if (userInput !== 'delete') {
        toast.warning('入力が一致しません。操作をキャンセルしました。');
        return;
    }

    try {
        await api.post('/backup/reset');
        toast.success('全てのデータを削除しました。');
        emit('close');
        setTimeout(() => {
            window.location.reload(); // Refresh to clear lists
        }, 1200);
    } catch (err) {
        console.error('Reset failed', err);
        toast.error('削除に失敗しました: ' + (err.response?.data?.error || err.message));
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
             <button class="btn btn-primary" @click="downloadFull" :disabled="exporting">
              📦 フルバックアップをダウンロード
            </button>
            
            <label class="btn btn-outline hover-danger">
              📥 バックアップから復元
              <input type="file" accept=".zip" class="hidden-input" @change="e => handleFullImport(e)" :disabled="importing">
            </label>
        </div>

        <div v-if="importing" class="status-msg info">
          ⏳ {{ importMessage }}
        </div>
        <div v-if="importError" class="status-msg error">
          ❌ {{ importError }}
        </div>
        <div v-if="exporting" class="export-progress">
          <div class="status-msg info">⏳ {{ exportMessage }}</div>
          <div class="progress-bar-container">
            <div class="progress-bar" :style="{ width: exportProgress + '%' }"></div>
          </div>
          <div class="progress-label">{{ exportProgress }}%</div>
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
  background: var(--bg-card-solid);
  color: var(--text-main);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 2rem;
  width: 100%;
  max-width: 500px;
  max-height: 90vh; /* Handle small screens */
  overflow-y: auto;
  position: relative;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
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
.status-msg.info { 
    color: var(--accent-color); 
    border-left: 3px solid var(--accent-color);
}

.footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 2rem;
}

.export-progress {
  margin-top: 1rem;
}

.progress-bar-container {
  margin-top: 0.5rem;
  background: rgba(255,255,255,0.1);
  border-radius: 4px;
  height: 8px;
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  background: var(--accent-color);
  border-radius: 4px;
  transition: width 0.3s ease;
}

.progress-label {
  text-align: right;
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin-top: 0.25rem;
}
</style>
