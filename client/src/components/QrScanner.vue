<script setup>
import { ref, computed, onUnmounted } from 'vue';
import { Html5Qrcode } from 'html5-qrcode';
import api from '../api';

// --- 状態管理 ---
const currentMode = ref('menu'); // 'menu' | 'scan-location' | 'scan-part' | 'scan-store-location' | 'scan-store-part' | 'register-location' | 'register-part' | 'location-info' | 'part-info' | 'store-done' | 'print'
const scannerActive = ref(false);
const scannedQrCode = ref('');
const statusMessage = ref('');
const statusType = ref(''); // 'success' | 'error' | 'info'

// 保管場所登録フォーム
const locationForm = ref({ name: '', description: '' });
const locationImage = ref(null);
const locationImagePreview = ref(null);

// 部品登録フォーム
const partForm = ref({ name: '', description: '', quantity: 1 });
const partImage = ref(null);
const partImagePreview = ref(null);

// カテゴリ・ロケーション
const categories = ref([]);
const locations = ref([]);
const selectedCategoryId = ref('');
const selectedLocationId = ref('');

// 情報表示用
const locationInfo = ref(null);
const partInfo = ref(null);

// 箱にしまうフロー
const storeLocationId = ref(null);
const storeLocationName = ref('');
const storedParts = ref([]);

// QR印刷
const printPrefix = ref('BOX');
const printStartNumber = ref(1);
const printCount = ref(44);

// スキャナーインスタンス
let html5QrCode = null;

// --- マスタデータ取得 ---
const loadMasterData = async () => {
    try {
        const [catRes, locRes] = await Promise.all([
            api.get('/categories'),
            api.get('/locations')
        ]);
        categories.value = catRes.data;
        locations.value = locRes.data;
    } catch (e) {
        console.error('マスタデータ取得エラー:', e);
    }
};
loadMasterData();

// --- QRスキャナー ---
const startScanner = async () => {
    // Vueの次のDOM更新サイクルを待つ（#qr-readerがDOMに存在することを保証）
    await new Promise(resolve => setTimeout(resolve, 300));

    const readerEl = document.getElementById('qr-reader');
    if (!readerEl) {
        showStatus('スキャナーの初期化に失敗しました（DOM未準備）', 'error');
        return;
    }

    // HTTPSチェック（iOS Safariではカメラ使用にHTTPS必須）
    const isSecure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!isSecure) {
        showStatus('⚠️ カメラを使うにはHTTPS接続が必要です。URLをhttps://で開いてください。', 'error');
        return;
    }

    try {
        // 前のインスタンスを確実にクリア
        if (html5QrCode) {
            try { await html5QrCode.stop(); } catch (e) { }
            html5QrCode = null;
        }
        // DOMの中身もクリア（html5-qrcodeが前のvideoを残すことがある）
        readerEl.innerHTML = '';

        html5QrCode = new Html5Qrcode('qr-reader');
        scannerActive.value = true;

        // カメラ設定（iOS Safari対応）
        const config = {
            fps: 10,
            qrbox: { width: 250, height: 250 },
            // iOS Safari向け: aspectRatioを指定しない（デフォルトにする）
            // videoConstraintsで明示的にfacingModeを指定
        };

        // まずbackカメラを試行、失敗したらカメラID指定で再試行
        try {
            await html5QrCode.start(
                { facingMode: 'environment' },
                config,
                onScanSuccess,
                () => {}
            );
        } catch (backCameraErr) {
            console.warn('背面カメラ起動失敗、カメラ一覧から取得を試行:', backCameraErr);
            
            // カメラ一覧を取得してリトライ
            try {
                const cameras = await Html5Qrcode.getCameras();
                if (cameras && cameras.length > 0) {
                    // 背面カメラを優先（ラベルにback/rear/environmentを含むもの）
                    const backCamera = cameras.find(c => 
                        /back|rear|environment/i.test(c.label)
                    ) || cameras[cameras.length - 1]; // 見つからなければ最後のカメラ（通常は背面）

                    await html5QrCode.start(
                        backCamera.id,
                        config,
                        onScanSuccess,
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
        let errorMsg = 'カメラの起動に失敗しました。';
        if (String(err).includes('NotAllowedError') || String(err).includes('Permission')) {
            errorMsg += '\nブラウザの設定でカメラの使用を許可してください。\n（iOS: 設定→Safari→カメラ）';
        } else if (String(err).includes('NotFoundError')) {
            errorMsg += '\nカメラが見つかりません。';
        } else if (String(err).includes('NotReadableError') || String(err).includes('TrackStartError')) {
            errorMsg += '\nカメラが他のアプリで使用中の可能性があります。';
        } else {
            errorMsg += '\n' + String(err);
        }
        showStatus(errorMsg, 'error');
        scannerActive.value = false;
    }
};

const stopScanner = async () => {
    if (html5QrCode) {
        try {
            if (scannerActive.value) {
                await html5QrCode.stop();
            }
        } catch (e) { }
        html5QrCode = null;
        scannerActive.value = false;
    }
};

const onScanSuccess = async (decodedText) => {
    await stopScanner();
    scannedQrCode.value = decodedText;

    // モードに応じた処理
    if (currentMode.value === 'scan-location') {
        await handleLocationScan(decodedText);
    } else if (currentMode.value === 'scan-part') {
        await handlePartScan(decodedText);
    } else if (currentMode.value === 'scan-store-location') {
        await handleStoreLocationScan(decodedText);
    } else if (currentMode.value === 'scan-store-part') {
        await handleStorePartScan(decodedText);
    }
};

// --- 保管場所登録 ---
const startLocationScan = () => {
    currentMode.value = 'scan-location';
    statusMessage.value = '';
    startScanner();
};

const handleLocationScan = async (qrCode) => {
    try {
        const res = await api.get(`/qr/lookup/${encodeURIComponent(qrCode)}`);
        if (res.data.type === 'location') {
            // 登録済み → 情報表示
            locationInfo.value = res.data.data;
            currentMode.value = 'location-info';
        } else if (res.data.type === 'part') {
            showStatus('このQRコードは部品として登録されています', 'error');
            currentMode.value = 'menu';
        } else {
            // 未登録 → 登録フォーム
            locationForm.value = { name: '', description: '' };
            locationImage.value = null;
            locationImagePreview.value = null;
            currentMode.value = 'register-location';
        }
    } catch (err) {
        showStatus('検索エラー: ' + err.message, 'error');
        currentMode.value = 'menu';
    }
};

const registerLocation = async () => {
    if (!locationForm.value.name.trim()) {
        showStatus('保管場所名を入力してください', 'error');
        return;
    }
    try {
        const formData = new FormData();
        formData.append('qr_code', scannedQrCode.value);
        formData.append('name', locationForm.value.name);
        formData.append('description', locationForm.value.description);
        if (locationImage.value) {
            formData.append('image', locationImage.value);
        }
        const res = await api.post('/qr/register-location', formData);
        showStatus(`保管場所「${locationForm.value.name}」を登録しました`, 'success');
        // 登録した保管場所の情報を表示
        const lookupRes = await api.get(`/qr/lookup/${encodeURIComponent(scannedQrCode.value)}`);
        locationInfo.value = lookupRes.data.data;
        currentMode.value = 'location-info';
    } catch (err) {
        showStatus('登録エラー: ' + (err.response?.data?.error || err.message), 'error');
    }
};

// --- 部品登録 ---
const startPartScan = () => {
    currentMode.value = 'scan-part';
    statusMessage.value = '';
    startScanner();
};

const handlePartScan = async (qrCode) => {
    try {
        const res = await api.get(`/qr/lookup/${encodeURIComponent(qrCode)}`);
        if (res.data.type === 'part') {
            // 登録済み → 情報表示
            partInfo.value = res.data.data;
            currentMode.value = 'part-info';
        } else if (res.data.type === 'location') {
            showStatus('このQRコードは保管場所として登録されています', 'error');
            currentMode.value = 'menu';
        } else {
            // 未登録 → 登録フォーム
            partForm.value = { name: '', description: '', quantity: 1 };
            partImage.value = null;
            partImagePreview.value = null;
            selectedCategoryId.value = '';
            selectedLocationId.value = '';
            currentMode.value = 'register-part';
        }
    } catch (err) {
        showStatus('検索エラー: ' + err.message, 'error');
        currentMode.value = 'menu';
    }
};

const registerPart = async () => {
    if (!partForm.value.name.trim()) {
        showStatus('部品名を入力してください', 'error');
        return;
    }
    try {
        const formData = new FormData();
        formData.append('qr_code', scannedQrCode.value);
        formData.append('name', partForm.value.name);
        formData.append('description', partForm.value.description);
        formData.append('quantity', partForm.value.quantity);
        if (selectedCategoryId.value) formData.append('category_id', selectedCategoryId.value);
        if (selectedLocationId.value) formData.append('location_id', selectedLocationId.value);
        if (partImage.value) {
            formData.append('image', partImage.value);
        }
        const res = await api.post('/qr/register-part', formData);

        showStatus(`部品「${partForm.value.name}」を登録しました`, 'success');
        // 登録した部品の情報を表示
        const partRes = await api.get(`/qr/lookup/${encodeURIComponent(scannedQrCode.value)}`);
        partInfo.value = partRes.data.data;
        currentMode.value = 'part-info';
    } catch (err) {
        showStatus('登録エラー: ' + (err.response?.data?.error || err.message), 'error');
    }
};

// --- 箱にしまう（保管場所にしまう） ---
const startStoreScan = () => {
    currentMode.value = 'scan-store-location';
    storeLocationId.value = null;
    storeLocationName.value = '';
    storedParts.value = [];
    statusMessage.value = '';
    startScanner();
};

const handleStoreLocationScan = async (qrCode) => {
    try {
        const res = await api.get(`/qr/lookup/${encodeURIComponent(qrCode)}`);
        if (res.data.type === 'location') {
            storeLocationId.value = res.data.data.id;
            storeLocationName.value = res.data.data.name;
            showStatus(`保管場所「${res.data.data.name}」を選択しました。部品をスキャンしてください`, 'info');
            currentMode.value = 'scan-store-part';
            startScanner();
        } else if (res.data.type === 'unknown') {
            showStatus('この保管場所は未登録です。先に保管場所登録を行ってください', 'error');
            currentMode.value = 'menu';
        } else {
            showStatus('これは保管場所のQRコードではありません', 'error');
            currentMode.value = 'menu';
        }
    } catch (err) {
        showStatus('検索エラー: ' + err.message, 'error');
        currentMode.value = 'menu';
    }
};

const handleStorePartScan = async (qrCode) => {
    try {
        const res = await api.get(`/qr/lookup/${encodeURIComponent(qrCode)}`);
        if (res.data.type === 'part') {
            // パーツを保管場所に紐付け
            await api.post('/qr/store', {
                part_id: res.data.data.id,
                location_id: storeLocationId.value
            });
            storedParts.value.push(res.data.data.name);
            showStatus(`「${res.data.data.name}」をしまいました`, 'success');
            // 続けてスキャン
            currentMode.value = 'scan-store-part';
            startScanner();
        } else if (res.data.type === 'location') {
            showStatus('これは保管場所のQRコードです。部品をスキャンしてください', 'error');
            currentMode.value = 'scan-store-part';
            startScanner();
        } else {
            showStatus('この部品は未登録です。先に部品登録を行ってください', 'error');
            currentMode.value = 'scan-store-part';
            startScanner();
        }
    } catch (err) {
        showStatus('紐付けエラー: ' + (err.response?.data?.error || err.message), 'error');
        currentMode.value = 'scan-store-part';
        startScanner();
    }
};

const finishStoring = async () => {
    await stopScanner();
    currentMode.value = 'store-done';
};

// --- QR印刷ツール ---
const openPrintTool = () => {
    currentMode.value = 'print';
    statusMessage.value = '';
};

const generatePdf = async () => {
    try {
        const { default: jsPDF } = await import('jspdf');
        const QRCode = await import('qrcode');

        const doc = new jsPDF('p', 'mm', 'a4');
        const cols = 4;
        const rows = 11;
        const totalPerPage = cols * rows; // 44枚
        const pages = Math.ceil(printCount.value / totalPerPage);

        // A4: 210mm x 297mm
        const marginX = 10;
        const marginY = 8;
        const cellW = (210 - marginX * 2) / cols;  // 約47.5mm
        const cellH = (297 - marginY * 2) / rows;  // 約25.5mm
        const qrSize = Math.min(cellW - 8, cellH - 10); // QRコードのサイズ（余白確保）

        let currentNum = printStartNumber.value;
        
        for (let page = 0; page < pages; page++) {
            if (page > 0) doc.addPage();

            for (let row = 0; row < rows; row++) {
                for (let col = 0; col < cols; col++) {
                    if (currentNum >= printStartNumber.value + printCount.value) break;

                    const id = `${printPrefix.value}-${String(currentNum).padStart(6, '0')}`;
                    const x = marginX + col * cellW;
                    const y = marginY + row * cellH;

                    // カットライン（薄いグレー破線）
                    doc.setDrawColor(200, 200, 200);
                    doc.setLineDashPattern([2, 2], 0);
                    doc.setLineWidth(0.3);
                    // 右線
                    if (col < cols - 1) {
                        doc.line(x + cellW, y, x + cellW, y + cellH);
                    }
                    // 下線
                    if (row < rows - 1) {
                        doc.line(x, y + cellH, x + cellW, y + cellH);
                    }

                    // QRコード生成
                    const qrDataUrl = await QRCode.toDataURL(id, {
                        width: 200,
                        margin: 1,
                        errorCorrectionLevel: 'M'
                    });

                    // QRコード配置（セル中央）
                    const qrX = x + (cellW - qrSize) / 2;
                    const qrY = y + 2;
                    doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);

                    // IDテキスト
                    doc.setLineDashPattern([], 0);
                    doc.setFontSize(6);
                    doc.setTextColor(80, 80, 80);
                    doc.text(id, x + cellW / 2, y + cellH - 1.5, { align: 'center' });

                    currentNum++;
                }
            }
        }

        doc.save(`qr_labels_${printPrefix.value}_${printStartNumber.value}.pdf`);
        showStatus('PDFを生成しました', 'success');
    } catch (err) {
        console.error('PDF生成エラー:', err);
        showStatus('PDF生成に失敗しました: ' + err.message, 'error');
    }
};

// --- 画像処理 ---
const onLocationImageChange = (event) => {
    const file = event.target.files[0];
    if (file) {
        locationImage.value = file;
        locationImagePreview.value = URL.createObjectURL(file);
    }
};

const onPartImageChange = (event) => {
    const file = event.target.files[0];
    if (file) {
        partImage.value = file;
        partImagePreview.value = URL.createObjectURL(file);
    }
};

// --- ユーティリティ ---
const showStatus = (message, type) => {
    statusMessage.value = message;
    statusType.value = type;
};

const backToMenu = async () => {
    await stopScanner();
    currentMode.value = 'menu';
    statusMessage.value = '';
};

// APIのベースURLからサーバーURL解決
const getImageUrl = (imagePath) => {
    if (!imagePath) return null;
    // /uploadsで始まるパスをサーバーURLに変換
    return `/api/../${imagePath}`;
};

// クリーンアップ
onUnmounted(() => {
    stopScanner();
});
</script>

<template>
  <div class="qr-app">
    <!-- ヘッダー -->
    <header class="qr-header glass-panel">
      <div class="header-row">
        <h1 class="qr-logo">
          <span class="icon">📦</span>
          <span class="title-gradient">QR 入出庫管理</span>
        </h1>
        <a href="/" class="btn-back">← メイン画面</a>
      </div>
    </header>

    <!-- ステータスメッセージ -->
    <div v-if="statusMessage" class="status-bar" :class="statusType">
      {{ statusMessage }}
    </div>

    <!-- メインメニュー -->
    <div v-if="currentMode === 'menu'" class="menu-container">
      <button class="menu-btn box-btn" @click="startLocationScan">
        <span class="menu-icon">📦</span>
        <span class="menu-label">保管場所登録(QR)</span>
        <span class="menu-desc">QRコードで保管場所を登録・確認</span>
      </button>

      <button class="menu-btn part-btn" @click="startPartScan">
        <span class="menu-icon">🔧</span>
        <span class="menu-label">部品登録(QR)</span>
        <span class="menu-desc">QRコードで部品を登録・確認</span>
      </button>

      <button class="menu-btn store-btn" @click="startStoreScan">
        <span class="menu-icon">📥</span>
        <span class="menu-label">しまう(QR)</span>
        <span class="menu-desc">部品を保管場所に紐付ける</span>
      </button>

      <button class="menu-btn print-btn" @click="openPrintTool">
        <span class="menu-icon">🖨️</span>
        <span class="menu-label">QRコード印刷</span>
        <span class="menu-desc">A4シール用のQRコードPDF生成</span>
      </button>
    </div>

    <!-- QRスキャナー -->
    <div v-if="currentMode.startsWith('scan-')" class="scanner-container">
      <div class="scan-instruction">
        <template v-if="currentMode === 'scan-location'">📦 保管場所のQRコードをスキャンしてください</template>
        <template v-else-if="currentMode === 'scan-part'">🔧 部品のQRコードをスキャンしてください</template>
        <template v-else-if="currentMode === 'scan-store-location'">📦 まず保管場所のQRコードをスキャンしてください</template>
        <template v-else-if="currentMode === 'scan-store-part'">
          🔧 「{{ storeLocationName }}」に入れる部品をスキャン
          <div v-if="storedParts.length > 0" class="stored-list">
            <span>登録済み: {{ storedParts.join(', ') }}</span>
          </div>
        </template>
      </div>
      <div id="qr-reader" class="qr-reader"></div>
      <div class="scan-actions">
        <button v-if="currentMode === 'scan-store-part' && storedParts.length > 0" class="btn btn-primary" @click="finishStoring">
          ✅ 完了
        </button>
        <button class="btn btn-cancel" @click="backToMenu">← 戻る</button>
      </div>
    </div>

    <!-- 保管場所登録フォーム -->
    <div v-if="currentMode === 'register-location'" class="form-container glass-panel">
      <h2>📦 保管場所を登録</h2>
      <p class="qr-id-display">QR: {{ scannedQrCode }}</p>

      <div class="form-group">
        <label>保管場所名 *</label>
        <input v-model="locationForm.name" type="text" placeholder="例: パーツ箱A" class="form-input" />
      </div>

      <div class="form-group">
        <label>説明</label>
        <input v-model="locationForm.description" type="text" placeholder="例: 赤い大きな箱" class="form-input" />
      </div>

      <div class="form-group">
        <label>📷 写真（任意）</label>
        <input type="file" accept="image/*" @change="onLocationImageChange" class="form-input-file" />
        <img v-if="locationImagePreview" :src="locationImagePreview" class="image-preview" />
      </div>

      <div class="form-actions">
        <button class="btn btn-primary" @click="registerLocation">登録する</button>
        <button class="btn btn-cancel" @click="backToMenu">キャンセル</button>
      </div>
    </div>

    <!-- 部品登録フォーム -->
    <div v-if="currentMode === 'register-part'" class="form-container glass-panel">
      <h2>🔧 部品を登録</h2>
      <p class="qr-id-display">QR: {{ scannedQrCode }}</p>

      <div class="form-group">
        <label>部品名 *</label>
        <input v-model="partForm.name" type="text" placeholder="例: 10kΩ抵抗" class="form-input" />
      </div>

      <div class="form-group">
        <label>説明</label>
        <input v-model="partForm.description" type="text" placeholder="例: 1/4W カーボン抵抗" class="form-input" />
      </div>

      <div class="form-group">
        <label>数量</label>
        <input v-model.number="partForm.quantity" type="number" min="0" class="form-input" />
      </div>

      <div class="form-group">
        <label>カテゴリ</label>
        <select v-model="selectedCategoryId" class="form-input">
          <option value="">-- 未選択 --</option>
          <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
        </select>
      </div>

      <div class="form-group">
        <label>保管場所</label>
        <select v-model="selectedLocationId" class="form-input">
          <option value="">-- 未選択 --</option>
          <option v-for="loc in locations" :key="loc.id" :value="loc.id">{{ loc.name }}</option>
        </select>
      </div>

      <div class="form-group">
        <label>📷 写真（任意）</label>
        <input type="file" accept="image/*" @change="onPartImageChange" class="form-input-file" />
        <img v-if="partImagePreview" :src="partImagePreview" class="image-preview" />
      </div>

      <div class="form-actions">
        <button class="btn btn-primary" @click="registerPart">登録する</button>
        <button class="btn btn-cancel" @click="backToMenu">キャンセル</button>
      </div>
    </div>

    <!-- 保管場所情報表示 -->
    <div v-if="currentMode === 'location-info' && locationInfo" class="info-container glass-panel">
      <h2>📦 保管場所情報</h2>
      <div class="info-card">
        <img v-if="locationInfo.image_path" :src="locationInfo.image_path" class="info-image" />
        <div class="info-details">
          <p class="info-name">{{ locationInfo.name }}</p>
          <p class="info-qr">QR: {{ locationInfo.qr_code }}</p>
          <p v-if="locationInfo.description" class="info-desc">{{ locationInfo.description }}</p>
        </div>
      </div>

      <div v-if="locationInfo.parts && locationInfo.parts.length > 0" class="parts-in-box">
        <h3>中のパーツ（{{ locationInfo.parts.length }}件）</h3>
        <ul class="parts-list-simple">
          <li v-for="part in locationInfo.parts" :key="part.id">
            <span class="part-name">{{ part.name }}</span>
            <span v-if="part.quantity" class="part-qty">×{{ part.quantity }}</span>
          </li>
        </ul>
      </div>
      <div v-else class="empty-box">
        <p>この保管場所にはまだ部品が入っていません</p>
      </div>

      <div class="form-actions">
        <button class="btn btn-cancel" @click="backToMenu">← メニューに戻る</button>
      </div>
    </div>

    <!-- 部品情報表示 -->
    <div v-if="currentMode === 'part-info' && partInfo" class="info-container glass-panel">
      <h2>🔧 部品情報</h2>
      <div class="info-card">
        <img v-if="partInfo.image_path" :src="partInfo.image_path" class="info-image" />
        <div class="info-details">
          <p class="info-name">{{ partInfo.name }}</p>
          <p class="info-qr">QR: {{ partInfo.qr_code }}</p>
          <p v-if="partInfo.description" class="info-desc">{{ partInfo.description }}</p>
          <p v-if="partInfo.quantity">数量: {{ partInfo.quantity }}</p>
          <p v-if="partInfo.category_name">カテゴリ: {{ partInfo.category_name }}</p>
          <p v-if="partInfo.location_name">保管場所: {{ partInfo.location_name }}</p>
        </div>
      </div>

      <div class="form-actions">
        <button class="btn btn-cancel" @click="backToMenu">← メニューに戻る</button>
      </div>
    </div>

    <!-- 箱にしまう完了 -->
    <div v-if="currentMode === 'store-done'" class="info-container glass-panel">
      <h2>✅ 登録完了</h2>
      <div class="store-result">
        <p>「<strong>{{ storeLocationName }}</strong>」に以下を登録しました:</p>
        <ul class="stored-result-list">
          <li v-for="(name, i) in storedParts" :key="i">{{ name }}</li>
        </ul>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" @click="startStoreScan">続けて登録</button>
        <button class="btn btn-cancel" @click="backToMenu">← メニューに戻る</button>
      </div>
    </div>

    <!-- QR印刷ツール -->
    <div v-if="currentMode === 'print'" class="form-container glass-panel">
      <h2>🖨️ QRコード印刷</h2>
      <p class="print-desc">A4全面シールに44枚のQRコードを印刷するPDFを生成します</p>

      <div class="form-group">
        <label>種類</label>
        <select v-model="printPrefix" class="form-input">
          <option value="BOX">BOX（保管場所用）</option>
          <option value="PARTS">PARTS（部品用）</option>
        </select>
      </div>

      <div class="form-group">
        <label>開始番号</label>
        <input v-model.number="printStartNumber" type="number" min="1" class="form-input" />
      </div>

      <div class="form-group">
        <label>生成枚数</label>
        <input v-model.number="printCount" type="number" min="1" max="440" class="form-input" />
        <p class="form-hint">※ 44枚 = A4 1シート分</p>
      </div>

      <div class="print-preview">
        <p>プレビュー: <strong>{{ printPrefix }}-{{ String(printStartNumber).padStart(6, '0') }}</strong> ～ <strong>{{ printPrefix }}-{{ String(printStartNumber + printCount - 1).padStart(6, '0') }}</strong></p>
        <p>{{ Math.ceil(printCount / 44) }}ページ分のPDFが生成されます</p>
      </div>

      <div class="form-actions">
        <button class="btn btn-primary" @click="generatePdf">📄 PDF生成</button>
        <button class="btn btn-cancel" @click="backToMenu">← 戻る</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.qr-app {
    min-height: 100vh;
    padding: 0.5rem;
    max-width: 480px;
    margin: 0 auto;
}

.qr-header {
    padding: 0.75rem 1rem;
    margin-bottom: 1rem;
}

.header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.qr-logo {
    font-size: 1.2rem;
    font-weight: 800;
    display: flex;
    align-items: center;
    gap: 0.4rem;
}

.btn-back {
    color: var(--text-secondary);
    font-size: 0.85rem;
    text-decoration: none;
    padding: 0.4rem 0.8rem;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    transition: all 0.2s;
}
.btn-back:hover {
    border-color: var(--accent-color);
    color: var(--accent-color);
}

/* ステータスバー */
.status-bar {
    padding: 0.75rem 1rem;
    border-radius: 10px;
    margin-bottom: 1rem;
    font-weight: 600;
    font-size: 0.9rem;
    animation: slideIn 0.3s ease;
}
.status-bar.success { background: rgba(34, 197, 94, 0.2); color: #22c55e; border: 1px solid rgba(34, 197, 94, 0.3); }
.status-bar.error { background: rgba(239, 68, 68, 0.2); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); }
.status-bar.info { background: rgba(56, 189, 248, 0.2); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); }

@keyframes slideIn {
    from { transform: translateY(-10px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
}

/* メインメニュー */
.menu-container {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.menu-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 1.5rem;
    border-radius: 16px;
    border: 1px solid var(--border-color);
    background: var(--bg-card);
    backdrop-filter: blur(12px);
    cursor: pointer;
    transition: all 0.3s ease;
}
.menu-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 25px rgba(0,0,0,0.3);
}
.menu-btn:active {
    transform: translateY(0);
}

.box-btn:hover { border-color: #f59e0b; }
.part-btn:hover { border-color: #22c55e; }
.store-btn:hover { border-color: #38bdf8; }
.print-btn:hover { border-color: #a78bfa; }

.menu-icon {
    font-size: 2.5rem;
    margin-bottom: 0.5rem;
}

.menu-label {
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--text-primary);
}

.menu-desc {
    font-size: 0.8rem;
    color: var(--text-secondary);
    margin-top: 0.25rem;
}

/* スキャナー */
.scanner-container {
    display: flex;
    flex-direction: column;
    gap: 1rem;
}

.scan-instruction {
    text-align: center;
    font-weight: 600;
    font-size: 1rem;
    padding: 1rem;
    background: var(--bg-card);
    border-radius: 12px;
    border: 1px solid var(--border-color);
}

.stored-list {
    margin-top: 0.5rem;
    font-size: 0.8rem;
    color: var(--text-secondary);
}

.qr-reader {
    border-radius: 12px;
    overflow: hidden;
}

.scan-actions {
    display: flex;
    gap: 0.75rem;
    justify-content: center;
}

/* フォーム */
.form-container {
    padding: 1.5rem;
}

.form-container h2 {
    margin-bottom: 1rem;
    font-size: 1.2rem;
}

.qr-id-display {
    background: rgba(56, 189, 248, 0.15);
    padding: 0.5rem 1rem;
    border-radius: 8px;
    font-family: monospace;
    font-size: 0.85rem;
    margin-bottom: 1rem;
    color: var(--accent-color);
}

.form-group {
    margin-bottom: 1rem;
}

.form-group label {
    display: block;
    font-size: 0.85rem;
    font-weight: 600;
    margin-bottom: 0.3rem;
    color: var(--text-secondary);
}

.form-input {
    width: 100%;
    padding: 0.75rem;
    background: rgba(0,0,0,0.3);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    color: var(--text-primary);
    font-size: 1rem;
    font-family: inherit;
}
.form-input:focus {
    border-color: var(--accent-color);
    outline: none;
}

.form-input-file {
    width: 100%;
    padding: 0.5rem;
    font-size: 0.9rem;
}

.image-preview {
    margin-top: 0.5rem;
    max-width: 100%;
    max-height: 200px;
    border-radius: 8px;
    object-fit: cover;
}

.form-hint {
    font-size: 0.75rem;
    color: var(--text-secondary);
    margin-top: 0.25rem;
}

.form-actions {
    display: flex;
    gap: 0.75rem;
    margin-top: 1.5rem;
}

.btn {
    padding: 0.75rem 1.5rem;
    border-radius: 10px;
    font-weight: 600;
    font-size: 1rem;
    flex: 1;
    text-align: center;
    transition: all 0.2s;
    border: none;
    cursor: pointer;
}

.btn-primary {
    background: var(--accent-gradient);
    color: white;
    box-shadow: 0 4px 15px rgba(14, 165, 233, 0.3);
}
.btn-primary:hover {
    transform: translateY(-1px);
}

.btn-cancel {
    background: rgba(255,255,255,0.05);
    color: var(--text-secondary);
    border: 1px solid var(--border-color);
}
.btn-cancel:hover {
    border-color: var(--text-secondary);
}

/* 情報表示 */
.info-container {
    padding: 1.5rem;
}

.info-container h2 {
    margin-bottom: 1rem;
}

.info-card {
    display: flex;
    gap: 1rem;
    padding: 1rem;
    background: rgba(0,0,0,0.2);
    border-radius: 12px;
    margin-bottom: 1rem;
}

.info-image {
    width: 80px;
    height: 80px;
    border-radius: 8px;
    object-fit: cover;
    flex-shrink: 0;
}

.info-name {
    font-size: 1.1rem;
    font-weight: 700;
}

.info-qr {
    font-family: monospace;
    font-size: 0.8rem;
    color: var(--accent-color);
}

.info-desc {
    font-size: 0.85rem;
    color: var(--text-secondary);
}

.parts-in-box h3 {
    font-size: 0.95rem;
    margin-bottom: 0.5rem;
}

.parts-list-simple {
    list-style: none;
    padding: 0;
}

.parts-list-simple li {
    display: flex;
    justify-content: space-between;
    padding: 0.5rem 0.75rem;
    background: rgba(0,0,0,0.15);
    border-radius: 8px;
    margin-bottom: 0.4rem;
}

.part-qty {
    color: var(--text-secondary);
    font-size: 0.85rem;
}

.empty-box {
    text-align: center;
    padding: 1rem;
    color: var(--text-secondary);
    font-size: 0.9rem;
}

/* 箱にしまう完了 */
.store-result {
    padding: 1rem;
    background: rgba(34, 197, 94, 0.1);
    border-radius: 12px;
    border: 1px solid rgba(34, 197, 94, 0.2);
}

.stored-result-list {
    list-style: none;
    padding: 0;
    margin-top: 0.5rem;
}
.stored-result-list li {
    padding: 0.4rem 0;
    border-bottom: 1px solid rgba(255,255,255,0.05);
}
.stored-result-list li::before {
    content: '✅ ';
}

/* 印刷プレビュー */
.print-desc {
    color: var(--text-secondary);
    font-size: 0.85rem;
    margin-bottom: 1rem;
}

.print-preview {
    background: rgba(0,0,0,0.2);
    padding: 1rem;
    border-radius: 8px;
    font-size: 0.85rem;
    margin-top: 0.5rem;
}
</style>
