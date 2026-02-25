<script setup>
import { ref, onBeforeUnmount } from 'vue';
import { Html5Qrcode } from 'html5-qrcode';

const emit = defineEmits(['scanned', 'close']);

const scanning = ref(false);
const scannerRef = ref(null);
let html5Qr = null;

const startScan = async () => {
  scanning.value = true;
  await new Promise(r => setTimeout(r, 100)); // DOMレンダリング待ち

  try {
    if (html5Qr) {
        try { await html5Qr.stop(); } catch(e) {}
        html5Qr = null;
    }
    const readerEl = document.getElementById('mini-qr-reader');
    if (readerEl) readerEl.innerHTML = '';

    html5Qr = new Html5Qrcode('mini-qr-reader');
    
    const config = { fps: 10, qrbox: { width: 200, height: 200 } };
    
    try {
        await html5Qr.start(
          { facingMode: 'environment' },
          config,
          (decodedText) => {
            emit('scanned', decodedText);
            stopScan();
          },
          () => {} // エラー（読み取り中の無視）
        );
    } catch (backCameraErr) {
        console.warn('背面カメラ直接起動失敗、カメラ一覧から取得を試行:', backCameraErr);
        try {
            const cameras = await Html5Qrcode.getCameras();
            if (cameras && cameras.length > 0) {
                const backCamera = cameras.find(c => 
                    /back|rear|environment/i.test(c.label)
                ) || cameras[cameras.length - 1]; // 見つからなければ最後のカメラ

                await html5Qr.start(
                    backCamera.id,
                    config,
                    (decodedText) => {
                        emit('scanned', decodedText);
                        stopScan();
                    },
                    () => {}
                );
            } else {
                throw new Error('利用可能なカメラが見つかりません');
            }
        } catch (retryErr) {
            throw retryErr;
        }
    }
  } catch (err) {
    console.error('カメラ起動エラー:', err);
    let msg = 'カメラを起動できません。';
    if (String(err).includes('NotAllowedError') || String(err).includes('Permission')) {
        msg += 'ブラウザのプレビュー権限を確認してください。';
    } else {
         msg += 'HTTPS環境が必要です。';
    }
    alert(msg);
    scanning.value = false;
  }
};

const stopScan = async () => {
  if (html5Qr) {
    try {
      await html5Qr.stop();
      html5Qr.clear();
    } catch (e) {}
    html5Qr = null;
  }
  scanning.value = false;
};

onBeforeUnmount(() => {
  stopScan();
});

// 初期化時に自動開始
startScan();
</script>

<template>
  <div class="mini-scanner-overlay" @click.self="stopScan(); $emit('close')">
    <div class="mini-scanner-modal">
      <div class="mini-scanner-header">
        <span>📷 QRコードをスキャン</span>
        <button class="btn-close" @click="stopScan(); $emit('close')">×</button>
      </div>
      <div id="mini-qr-reader" class="scanner-area"></div>
      <p class="scanner-hint">QRコードをカメラにかざしてください</p>
    </div>
  </div>
</template>

<style scoped>
.mini-scanner-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.mini-scanner-modal {
  background: #1e293b;
  border-radius: 12px;
  padding: 1rem;
  width: 90%;
  max-width: 350px;
}

.mini-scanner-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
  font-weight: 600;
  color: white;
}

.btn-close {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 1.5rem;
  cursor: pointer;
  line-height: 1;
}

.scanner-area {
  border-radius: 8px;
  overflow: hidden;
}

.scanner-hint {
  text-align: center;
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin-top: 0.5rem;
}
</style>
