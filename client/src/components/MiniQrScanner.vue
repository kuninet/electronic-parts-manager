<script setup>
import { ref, onBeforeUnmount, onMounted, nextTick } from 'vue';
import { Html5Qrcode } from 'html5-qrcode';
import { useToast } from '../composables/useToast';

const toast = useToast();
const emit = defineEmits(['scanned', 'close']);

const scanning = ref(false);
const scannerRef = ref(null);
let html5Qr = null;

const startScan = async () => {
  scanning.value = true;

  try {
    if (html5Qr) {
        try { await html5Qr.stop(); } catch(e) {}
        html5Qr = null;
    }
    const readerEl = document.getElementById('mini-qr-reader');
    if (readerEl) readerEl.innerHTML = '';

    html5Qr = new Html5Qrcode('mini-qr-reader');
    
    const config = { fps: 10, qrbox: { width: 200, height: 200 } };
    let isSuccessfulScan = false;
    try {
        await html5Qr.start(
          { facingMode: 'environment' },
          config,
          (decodedText) => {
            console.log('QR読み取り成功(environment):', decodedText);
            isSuccessfulScan = true;
            emit('scanned', decodedText);
            setTimeout(() => stopScan(), 300);
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
                        console.log('QR読み取り成功(fallback):', decodedText);
                        isSuccessfulScan = true;
                        emit('scanned', decodedText);
                        setTimeout(() => stopScan(), 300);
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
    if (isSuccessfulScan) {
        console.log('スキャン成功後に発生した例外をスキップ:', err);
        return;
    }
    console.error('カメラ起動エラー:', err);
    let msg = `カメラを起動できません。\n[詳細] ${String(err)}\n\n`;
    if (String(err).includes('NotAllowedError') || String(err).includes('Permission')) {
        msg += 'ブラウザのプレビュー（カメラ）権限を確認してください。';
    } else {
         msg += '原因不明の場合はHTTPS環境かどうかもご確認ください。';
    }
    toast.error(msg);
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

onMounted(async () => {
  await nextTick(); // DOMの描画を確実に待つ
  startScan();
});
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
  background: var(--bg-card-solid);
  color: var(--text-main);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 1rem;
  width: 90%;
  max-width: 350px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
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
