<script setup>
import { ref, computed, onUnmounted } from 'vue';
import { Html5Qrcode } from 'html5-qrcode';
import api from '../api';
import { resizeImageFile } from '../utils/imageResize';
import StoredPartCard from './qr/StoredPartCard.vue';
import {
    addStoreResult,
    markUndoing,
    markUndone,
    markUndoError,
    activeCount,
    shouldIgnoreScan
} from '../utils/storeSession';

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
const resizingLocationImage = ref(false);

// 部品登録フォーム
const partForm = ref({ name: '', part_number: '', description: '', quantity: 1 });
const partImage = ref(null);
const partImagePreview = ref(null);
const registeringPart = ref(false);
const resizingPartImage = ref(false);

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
const storeEntries = ref([]);
const storeActiveCount = computed(() => activeCount(storeEntries.value));
const lastScannedText = ref(null);
const lastScannedAt = ref(0);

// QR印刷
const printPrefix = ref('BOX');
const printStartNumber = ref(1);
const printCount = ref(44);

// スキャナーインスタンス
let html5QrCode = null;
let disposed = false; // アンマウント・停止・再起動のあとに start() が完了した場合にカメラを止めるため

const createUnnamedPartLabel = () => {
    const now = new Date();
    const timestamp = now.toLocaleString('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
    return `(名称未設定) ${timestamp}`;
};

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

        const instance = new Html5Qrcode('qr-reader');
        html5QrCode = instance;
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
            await instance.start(
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

                    await instance.start(
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

        // 起動が終わった時点で、自分がもう現役のインスタンスでなければ止める
        if (disposed || html5QrCode !== instance) {
            try { await instance.stop(); } catch (e) { }
            return;
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
    scannedQrCode.value = decodedText;

    // モードに応じた処理
    if (currentMode.value === 'scan-location') {
        await stopScanner();
        await handleLocationScan(decodedText);
    } else if (currentMode.value === 'scan-part') {
        await stopScanner();
        await handlePartScan(decodedText);
    } else if (currentMode.value === 'scan-store-location') {
        await stopScanner();
        await handleStoreLocationScan(decodedText);
    } else if (currentMode.value === 'scan-store-part') {
        // B-1: 3秒以内の同一QRコード再読取をpause前に早期無視（映像のちらつきと無駄なAPI呼出を防止）
        const now = Date.now();
        if (shouldIgnoreScan({
            text: decodedText,
            lastText: lastScannedText.value,
            lastAt: lastScannedAt.value,
            now
        })) {
            return;
        }
        lastScannedText.value = decodedText;
        lastScannedAt.value = now;

        // D8: 連続スキャン時はカメラを破棄せず一時停止（映像も止める）
        if (html5QrCode && typeof html5QrCode.pause === 'function') {
            try {
                html5QrCode.pause(true);
            } catch (e) {
                console.warn('html5QrCode.pause failed, stopping scanner instead:', e);
                await stopScanner();
            }
        } else {
            await stopScanner();
        }
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
            partForm.value = { name: '', part_number: '', description: '', quantity: 1 };
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
    if (registeringPart.value) {
        return;
    }

    const resolvedName = partForm.value.name.trim() || createUnnamedPartLabel();
    registeringPart.value = true;

    try {
        const formData = new FormData();
        formData.append('qr_code', scannedQrCode.value);
        formData.append('name', resolvedName);
        formData.append('part_number', partForm.value.part_number || '');
        formData.append('description', partForm.value.description);
        formData.append('quantity', partForm.value.quantity);
        if (selectedCategoryId.value) formData.append('category_id', selectedCategoryId.value);
        if (selectedLocationId.value) formData.append('location_id', selectedLocationId.value);
        if (partImage.value) {
            formData.append('image', partImage.value);
        }
        const res = await api.post('/qr/register-part', formData);

        partForm.value.name = resolvedName;
        showStatus(`部品「${resolvedName}」を登録しました`, 'success');
        // 登録した部品の情報を表示
        const partRes = await api.get(`/qr/lookup/${encodeURIComponent(scannedQrCode.value)}`);
        partInfo.value = partRes.data.data;
        currentMode.value = 'part-info';
    } catch (err) {
        showStatus('登録エラー: ' + (err.response?.data?.error || err.message), 'error');
    } finally {
        registeringPart.value = false;
    }
};

// --- 箱にしまう（保管場所にしまう） ---
const startStoreScan = () => {
    currentMode.value = 'scan-store-location';
    storeLocationId.value = null;
    storeLocationName.value = '';
    storeEntries.value = [];
    lastScannedText.value = null;
    lastScannedAt.value = 0;
    statusMessage.value = '';
    startScanner();
};

const handleStoreLocationScan = async (qrCode) => {
    try {
        const res = await api.get(`/qr/lookup/${encodeURIComponent(qrCode)}`);
        if (res.data.type === 'location') {
            storeLocationId.value = res.data.data.id;
            storeLocationName.value = res.data.data.name;
            // B-1: 保管場所QRを記録し、直後に同じ箱QRを読み直してエラーになるのを防止
            lastScannedText.value = qrCode;
            lastScannedAt.value = Date.now();
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

// D8: 一時停止から再開、または再起動
const resumeScanner = async () => {
    try {
        if (html5QrCode && typeof html5QrCode.resume === 'function') {
            html5QrCode.resume();
        } else {
            await startScanner();
        }
    } catch (e) {
        console.warn('resume failed, falling back to startScanner:', e);
        await startScanner();
    }
};

const handleStorePartScan = async (qrCode) => {
    try {
        const res = await api.get(`/qr/lookup/${encodeURIComponent(qrCode)}`);
        // m-1: 非同期通信後に画面モードが変わっていれば中断
        if (currentMode.value !== 'scan-store-part') return;

        if (res.data.type === 'part') {
            const partData = res.data.data;
            // パーツを保管場所に紐付け
            const storeRes = await api.post('/qr/store', {
                part_id: partData.id,
                location_id: storeLocationId.value
            });
            // m-1: 非同期通信後に画面モードが変わっていれば中断
            if (currentMode.value !== 'scan-store-part') return;

            storeEntries.value = addStoreResult(storeEntries.value, {
                part: partData,
                response: storeRes.data
            });

            if (storeRes.data.unchanged) {
                showStatus(`「${partData.name}」は既にこの保管場所にあります`, 'info');
            } else {
                const prevLoc = storeRes.data.previous_location_name || '未設定';
                showStatus(`「${partData.name}」をしまいました（元: ${prevLoc}）`, 'success');
            }
            // 続けてスキャン
            await resumeScanner();
        } else if (res.data.type === 'location') {
            showStatus('これは保管場所のQRコードです。部品をスキャンしてください', 'error');
            await resumeScanner();
        } else {
            showStatus('この部品は未登録です。先に部品登録を行ってください', 'error');
            await resumeScanner();
        }
    } catch (err) {
        if (currentMode.value !== 'scan-store-part') return;
        showStatus('紐付けエラー: ' + (err.response?.data?.error || err.message), 'error');
        await resumeScanner();
    }
};

const undoStore = async (entry) => {
    if (!entry || !entry.logId) return;
    storeEntries.value = markUndoing(storeEntries.value, entry.key);
    try {
        const res = await api.post('/qr/store/undo', { log_id: entry.logId });
        storeEntries.value = markUndone(storeEntries.value, entry.key, res.data);
        const restoredName = res.data.restored_location_name || '未設定';
        showStatus(`「${entry.part.name}」の格納を取り消しました（元: ${restoredName}）`, 'success');
    } catch (err) {
        const isConflict = err.response?.status === 409;
        const msg = err.response?.data?.error || err.message || '取り消しに失敗しました';
        storeEntries.value = markUndoError(storeEntries.value, entry.key, {
            message: msg,
            retryable: !isConflict
        });
        showStatus(`取り消しエラー: ${msg}`, 'error');
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
const onLocationImageChange = async (event) => {
    const file = event.target.files?.[0];
    if (locationImagePreview.value) {
        URL.revokeObjectURL(locationImagePreview.value);
        locationImagePreview.value = null;
    }
    if (file) {
        resizingLocationImage.value = true;
        try {
            const resized = await resizeImageFile(file);
            locationImage.value = resized;
            locationImagePreview.value = URL.createObjectURL(resized);
        } finally {
            resizingLocationImage.value = false;
        }
    } else {
        locationImage.value = null;
    }
};

const onPartImageChange = async (event) => {
    const file = event.target.files?.[0];
    if (partImagePreview.value) {
        URL.revokeObjectURL(partImagePreview.value);
        partImagePreview.value = null;
    }
    if (file) {
        resizingPartImage.value = true;
        try {
            const resized = await resizeImageFile(file);
            partImage.value = resized;
            partImagePreview.value = URL.createObjectURL(resized);
        } finally {
            resizingPartImage.value = false;
        }
    } else {
        partImage.value = null;
    }
};

// --- ユーティリティ ---
const showStatus = (message, type) => {
    statusMessage.value = message;
    statusType.value = type;
};

const backToMenu = async () => {
    await stopScanner();
    storeEntries.value = [];
    lastScannedText.value = null;
    lastScannedAt.value = 0;
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
    disposed = true;
    stopScanner();
    if (locationImagePreview.value) {
        URL.revokeObjectURL(locationImagePreview.value);
        locationImagePreview.value = null;
    }
    if (partImagePreview.value) {
        URL.revokeObjectURL(partImagePreview.value);
        partImagePreview.value = null;
    }
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
        <a href="#/" class="btn-back">← メイン画面</a>
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
          🔧 「{{ storeLocationName }}」に入れる部品をスキャン ・ しまった部品: {{ storeActiveCount }} 件
        </template>
      </div>
      <div id="qr-reader" class="qr-reader"></div>
      <div class="scan-actions">
        <button v-if="currentMode === 'scan-store-part' && storeEntries.length > 0" class="btn btn-primary" @click="finishStoring">
          ✅ 完了
        </button>
        <button class="btn btn-cancel" @click="backToMenu">← 戻る</button>
      </div>
      <div v-if="currentMode === 'scan-store-part' && storeEntries.length > 0" class="stored-cards-section">
        <h3 class="stored-cards-title">この箱にしまった部品</h3>
        <div class="stored-cards-list">
          <StoredPartCard
            v-for="entry in storeEntries"
            :key="entry.key"
            :item="entry"
            @undo="undoStore"
          />
        </div>
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
        <input type="file" accept="image/*" @change="onLocationImageChange" class="form-input-file" :disabled="resizingLocationImage" />
        <p v-if="resizingLocationImage" class="resizing-text" style="color: var(--accent); font-size: 0.85rem; margin-top: 0.3rem;">⏳ 画像を最適化中...</p>
        <img v-if="locationImagePreview && !resizingLocationImage" :src="locationImagePreview" class="image-preview" />
      </div>

      <div class="form-actions">
        <button class="btn btn-primary" @click="registerLocation" :disabled="resizingLocationImage">登録する</button>
        <button class="btn btn-cancel" @click="backToMenu">キャンセル</button>
      </div>
    </div>

    <!-- 部品登録フォーム -->
    <div v-if="currentMode === 'register-part'" class="form-container glass-panel">
      <div class="form-header">
        <h2>🔧 部品を登録</h2>
        <button class="btn btn-primary btn-header-action" @click="registerPart" :disabled="registeringPart || resizingPartImage">
          {{ registeringPart ? '登録中...' : (resizingPartImage ? '画像最適化中...' : '登録する') }}
        </button>
      </div>
      <p class="qr-id-display">QR: {{ scannedQrCode }}</p>

      <div class="form-group">
        <label>部品名</label>
        <input v-model="partForm.name" type="text" placeholder="未入力なら日時付きで自動入力" class="form-input" />
      </div>

      <div class="form-group">
        <label>型番</label>
        <input v-model="partForm.part_number" type="text" placeholder="例: NE555P（任意）" maxlength="100" class="form-input" />
      </div>

      <div class="form-group">
        <label>説明</label>
        <input v-model="partForm.description" type="text" placeholder="例: 1/4W カーボン抵抗" class="form-input" />
      </div>

      <div class="form-group">
        <label>📷 写真（任意）</label>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          @change="onPartImageChange"
          class="form-input-file"
          :disabled="resizingPartImage"
        />
        <p class="form-hint">スマホやiPadではカメラが優先して開きます。</p>
        <p v-if="resizingPartImage" class="resizing-text" style="color: var(--accent); font-size: 0.85rem; margin-top: 0.3rem;">⏳ 画像を最適化中...</p>
        <img v-if="partImagePreview && !resizingPartImage" :src="partImagePreview" class="image-preview" />
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

      <div class="form-actions">
        <button class="btn btn-primary" @click="registerPart" :disabled="registeringPart">
          {{ registeringPart ? '登録中...' : '登録する' }}
        </button>
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
            <span v-if="part.part_number" class="part-number-badge" style="margin-left: 0.3rem; font-size: 0.75rem;">🔖 {{ part.part_number }}</span>
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
          <p v-if="partInfo.part_number" class="info-pn" style="font-family: monospace; color: #c084fc;">🔖 型番: {{ partInfo.part_number }}</p>
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
        <div v-if="storeEntries.length > 0" class="stored-cards-list done-cards-list">
          <StoredPartCard
            v-for="entry in storeEntries"
            :key="entry.key"
            :item="entry"
            @undo="undoStore"
          />
        </div>
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
    min-height: 100dvh;
    padding: 0.5rem;
    padding-top: calc(0.5rem + env(safe-area-inset-top));
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
    color: var(--text-2);
    font-size: 0.85rem;
    text-decoration: none;
    padding: 0.4rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    transition: all 0.2s;
}
.btn-back:hover {
    border-color: var(--accent);
    color: var(--accent);
}

/* ステータスバー */
.status-bar {
    padding: 0.75rem 1rem;
    border-radius: var(--radius-md);
    margin-bottom: 1rem;
    font-weight: 600;
    font-size: 0.9rem;
    animation: slideIn 0.3s ease;
}
.status-bar.success { background: var(--ok-bg); color: var(--ok-fg); border: 1px solid var(--ok); }
.status-bar.error { background: var(--ng-bg); color: var(--ng-fg); border: 1px solid var(--ng); }
.status-bar.info { background: var(--accent-soft); color: var(--accent); border: 1px solid var(--accent); }

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
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    background: var(--surface);
    cursor: pointer;
    transition: all 0.3s ease;
}
.menu-btn:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-lg);
}
.menu-btn:active {
    transform: translateY(0);
}

.box-btn:hover { border-color: var(--warn); }
.part-btn:hover { border-color: var(--ok-fg); }
.store-btn:hover { border-color: var(--accent); }
.print-btn:hover { border-color: var(--accent); }

.menu-icon {
    font-size: 2.5rem;
    margin-bottom: 0.5rem;
}

.menu-label {
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--text);
}

.menu-desc {
    font-size: 0.8rem;
    color: var(--text-2);
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
    background: var(--surface);
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
}

.qr-reader {
    border-radius: var(--radius-md);
    overflow: hidden;
    min-height: 240px;
}

.scan-actions {
    display: flex;
    gap: 0.75rem;
    justify-content: center;
}

.stored-cards-section {
    width: 100%;
    max-width: 400px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.stored-cards-title {
    font-size: var(--fs-13);
    font-weight: 600;
    color: var(--text-2);
    margin: 0;
}

.stored-cards-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.done-cards-list {
    margin-top: var(--space-2);
}

/* フォーム */
.form-container {
    padding: 1.5rem;
}

.form-container h2 {
    margin-bottom: 0;
    font-size: 1.2rem;
}

.form-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 1rem;
}

.qr-id-display {
    background: var(--accent-soft);
    padding: 0.5rem 1rem;
    border-radius: var(--radius-md);
    font-family: monospace;
    font-size: 0.85rem;
    margin-bottom: 1rem;
    color: var(--accent);
}

.form-group {
    margin-bottom: 1rem;
}

.form-group label {
    display: block;
    font-size: 0.85rem;
    font-weight: 600;
    margin-bottom: 0.3rem;
    color: var(--text-2);
}

.form-input {
    width: 100%;
    padding: 0.75rem;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    color: var(--text);
    font-size: 1rem;
    font-family: inherit;
}
.form-input:focus {
    border-color: var(--accent);
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
    border-radius: var(--radius-md);
    object-fit: cover;
}

.form-hint {
    font-size: 0.75rem;
    color: var(--text-2);
    margin-top: 0.25rem;
}

.form-actions {
    display: flex;
    gap: 0.75rem;
    margin-top: 1.5rem;
}

.btn {
    padding: 0.75rem 1.5rem;
    border-radius: var(--radius-md);
    font-weight: 600;
    font-size: 1rem;
    flex: 1;
    text-align: center;
    transition: all 0.2s;
    border: none;
    cursor: pointer;
}

.btn-primary {
    background: var(--accent);
    color: white; /* theme-exempt: プライマリボタンの白文字 */
    box-shadow: var(--shadow-md);
}
.btn-primary:hover {
    transform: translateY(-1px);
}

.btn:disabled {
    opacity: 0.7;
    cursor: wait;
}

.btn-header-action {
    flex: 0 0 auto;
    min-width: 7rem;
    padding-inline: 1rem;
}

.btn-cancel {
    background: var(--surface-2);
    color: var(--text-2);
    border: 1px solid var(--border);
}
.btn-cancel:hover {
    border-color: var(--border-strong);
}

@media (max-width: 480px) {
    .form-header {
        align-items: stretch;
        flex-direction: column;
    }

    .btn-header-action {
        width: 100%;
    }
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
    background: var(--surface-2);
    border-radius: var(--radius-md);
    margin-bottom: 1rem;
}

.info-image {
    width: 80px;
    height: 80px;
    border-radius: var(--radius-md);
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
    color: var(--accent);
}

.info-desc {
    font-size: 0.85rem;
    color: var(--text-2);
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
    background: var(--surface-2);
    border-radius: var(--radius-md);
    margin-bottom: 0.4rem;
}

.part-qty {
    color: var(--text-2);
    font-size: 0.85rem;
}

.empty-box {
    text-align: center;
    padding: 1rem;
    color: var(--text-2);
    font-size: 0.9rem;
}

/* 箱にしまう完了 */
.store-result {
    padding: 1rem;
    background: var(--ok-bg);
    border-radius: var(--radius-md);
    border: 1px solid var(--ok);
}

/* 印刷プレビュー */
.print-desc {
    color: var(--text-2);
    font-size: 0.85rem;
    margin-bottom: 1rem;
}

.print-preview {
    background: var(--surface-2);
    padding: 1rem;
    border-radius: var(--radius-md);
    font-size: 0.85rem;
    margin-top: 0.5rem;
}

@media (max-width: 768px) {
    .qr-app {
        padding-bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom) + 0.5rem);
    }
}
</style>
