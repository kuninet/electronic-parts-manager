<script setup>
import { ref } from 'vue';
import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';

const emit = defineEmits(['close']);

// PDF Generation Settings
const prefix = ref(''); // ユーザーの任意文字列
const isDateTimeIncluded = ref(true);
const startNumber = ref(1);
const quantity = ref(44); // Default 1 sheet (4x11)
const drawOuterBorder = ref(false); // 外枠印刷オプション
const isGenerating = ref(false);

const getFormattedDateTime = () => {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  return `${yy}${mm}${dd}-${hh}${min}`;
};

const generatePreviewId = (num) => {
  const parts = [];
  if (prefix.value) parts.push(prefix.value);
  if (isDateTimeIncluded.value) parts.push(getFormattedDateTime());
  parts.push(String(num).padStart(3, '0'));
  return parts.join('-');
};

const generatePDF = async () => {
  if (quantity.value < 1) return;
  isGenerating.value = true;
  
  try {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    // A4 size: 210 x 297 mm
    const A4_WIDTH = 210;
    const A4_HEIGHT = 297;
    
    // Layout config
    const MARGIN_X = 10;
    const MARGIN_Y = 10;
    const COLS = 4;
    const ROWS = 11;
    
    const CELL_WIDTH = (A4_WIDTH - MARGIN_X * 2) / COLS; // 47.5mm
    const CELL_HEIGHT = (A4_HEIGHT - MARGIN_Y * 2) / ROWS; // ~25.18mm
    
    const QR_SIZE = 18; // mm

    // Set font for text
    doc.setFontSize(8);
    // Draw cut lines (light gray, dashed)
    doc.setDrawColor(200, 200, 200);
    doc.setLineDash([1, 1], 0);

    // Helper to draw outer border for the current page
    const drawPageBorder = () => {
      doc.rect(
        MARGIN_X, 
        MARGIN_Y, 
        A4_WIDTH - MARGIN_X * 2, 
        A4_HEIGHT - MARGIN_Y * 2
      );
    };

    // Draw border for the first page
    if (drawOuterBorder.value) {
      drawPageBorder();
    }

    let currentItemNum = startNumber.value;
    let itemsGenerated = 0;

    const baseDateTime = isDateTimeIncluded.value ? getFormattedDateTime() : '';

    while (itemsGenerated < quantity.value) {
      if (itemsGenerated > 0 && itemsGenerated % (COLS * ROWS) === 0) {
        doc.addPage();
        doc.setDrawColor(200, 200, 200);
        doc.setLineDash([1, 1], 0);
        if (drawOuterBorder.value) {
          drawPageBorder();
        }
      }

      const pageItemIndex = itemsGenerated % (COLS * ROWS);
      const col = pageItemIndex % COLS;
      const row = Math.floor(pageItemIndex / COLS);

      const x = MARGIN_X + col * CELL_WIDTH;
      const y = MARGIN_Y + row * CELL_HEIGHT;

      // Draw horizontal cut line (top of cell, skip first row margin)
      if (drawOuterBorder.value && row > 0 && col === 0) {
        doc.line(MARGIN_X, y, A4_WIDTH - MARGIN_X, y);
      }
      // Draw vertical cut line (left of cell, skip first col margin)
      if (drawOuterBorder.value && col > 0 && row === 0) {
        doc.line(x, MARGIN_Y, x, A4_HEIGHT - MARGIN_Y);
      }

      // Format ID: e.g., BOX-260223-1430-001 or just 260223-1430-001
      const parts = [];
      if (prefix.value) parts.push(prefix.value);
      if (baseDateTime) parts.push(baseDateTime);
      parts.push(String(currentItemNum).padStart(3, '0'));
      const idString = parts.join('-');

      // Generate QR Code Data URL
      const qrDataUrl = await QRCode.toDataURL(idString, {
        errorCorrectionLevel: 'M',
        margin: 0,
        width: 150 // pixel size for good resolution
      });

      // Calculate positions within the cell
      // We want QR and text to be centered in the cell.
      // E.g., QR left, text right, or QR top, text bottom.
      // Let's do QR left (margin 2mm), text right.
      const qrX = x + 2;
      const qrY = y + (CELL_HEIGHT - QR_SIZE) / 2; // vertically centered
      
      doc.addImage(qrDataUrl, 'PNG', qrX, qrY, QR_SIZE, QR_SIZE);
      
      // Text
      const textX = qrX + QR_SIZE + 2;
      const maxTextWidth = CELL_WIDTH - (textX - x) - 2; // remaining width in cell
      
      doc.setFontSize(8);
      // Split text if it's too long
      const textLines = doc.splitTextToSize(idString, maxTextWidth);
      
      // Calculate vertical start so that the block of text is centered
      // Approx 3mm height per line at size 8
      const lineHeight = 3; 
      const totalTextHeight = textLines.length * lineHeight;
      const startTextY = y + (CELL_HEIGHT - totalTextHeight) / 2 + (lineHeight * 0.75); // baseline adjustment
      
      doc.text(textLines, textX, startTextY);

      itemsGenerated++;
      currentItemNum++;
    }

    // Reset dash for any later drawings, though unnecessary here
    doc.setLineDash([]);

    // Save PDF
    const safePrefix = prefix.value ? prefix.value + '_' : '';
    const dateStr = baseDateTime ? baseDateTime + '_' : '';
    doc.save(`QR_Labels_${safePrefix}${dateStr}${String(startNumber.value).padStart(3,'0')}.pdf`);
    
  } catch (error) {
    console.error('Error generating PDF:', error);
    alert('PDFの生成中にエラーが発生しました。');
  } finally {
    isGenerating.value = false;
  }
};
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-content glass-panel">
      <h2>🖨️ QRコード印刷ツール</h2>
      <p class="desc">A4全面シール（4列×11行＝44面）に最適化されたPDFを生成します。</p>

      <div class="form-container">
        <div class="form-group">
          <label>プレフィックス（任意）</label>
          <input type="text" v-model="prefix" placeholder="BOX, PARTS など" class="text-input" />
        </div>

        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" v-model="isDateTimeIncluded" />
            現在日時（YYMMDD-HHmm）をIDに含める
          </label>
        </div>

        <div class="form-row">
          <div class="form-group" style="flex: 0.5;">
            <label>開始連番</label>
            <input type="number" v-model.number="startNumber" min="1" class="num-input"/>
          </div>

          <div class="form-group" style="flex: 0.5;">
            <label>生成枚数</label>
            <input type="number" v-model.number="quantity" min="1" class="num-input"/>
            <small>1シート = 44枚</small>
          </div>
        </div>
        
        <div class="form-group preview-id-box">
          <span class="preview-label">出力イメージ:</span>
          <span class="preview-value">{{ generatePreviewId(startNumber || 1) }}</span>
        </div>

        <div class="form-group border-option">
          <label class="checkbox-label">
             <input type="checkbox" v-model="drawOuterBorder" />
             📋 シールの枠線・カットガイド（薄い破線）をすべて印刷する
          </label>
        </div>
      </div>

      <div class="preview-info">
        <h3>💡 印刷時のご注意</h3>
        <ul>
          <li>「実際のサイズ」または「倍率 100%」で印刷してください</li>
          <li>「用紙サイズに合わせる」などはオフにしてください</li>
        </ul>
      </div>

      <div class="footer">
        <button class="btn" @click="$emit('close')" :disabled="isGenerating">閉じる</button>
        <button class="btn btn-primary btn-generate" @click="generatePDF" :disabled="isGenerating">
          {{ isGenerating ? 'PDF生成中...' : 'PDFをダウンロード' }}
        </button>
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
  padding: 1rem;
}

.modal-content {
  background: #1e293b;
  padding: 1.5rem;
  width: 100%;
  max-width: 500px;
  border-radius: 12px;
}

h2 {
  margin-bottom: 0.5rem;
  color: var(--accent-color);
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.desc {
  color: var(--text-secondary);
  font-size: 0.9rem;
  margin-bottom: 1.5rem;
}

.form-container {
  background: rgba(0,0,0,0.2);
  padding: 1rem;
  border-radius: 8px;
  margin-bottom: 1.5rem;
}

.form-group {
  margin-bottom: 1rem;
}

.form-group label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: bold;
  font-size: 0.95rem;
  color: white;
}

.form-row {
  display: flex;
  gap: 1rem;
}

.form-row .form-group {
  flex: 1;
}

.text-input {
  width: 100%;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border-color);
  padding: 0.6rem;
  border-radius: 6px;
  color: white;
  font-size: 1rem;
}

.text-input:focus {
  outline: none;
  border-color: var(--accent-color);
}

.checkbox-label {
  display: flex !important;
  align-items: center;
  gap: 0.5rem;
  font-weight: normal !important;
  cursor: pointer;
  color: var(--text-secondary) !important;
}

.checkbox-label input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: var(--accent-color);
}

.preview-id-box {
  background: rgba(0,0,0,0.3);
  padding: 0.75rem;
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 1rem;
}

.preview-label {
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.preview-value {
  color: #f59e0b;
  font-family: monospace;
  font-size: 1.1rem;
  font-weight: bold;
}

.border-option {
  margin-top: 1.5rem;
  padding-top: 1rem;
  border-top: 1px solid rgba(255,255,255,0.05);
}

.num-input {
  width: 100%;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border-color);
  padding: 0.6rem;
  border-radius: 6px;
  color: white;
  font-size: 1.1rem;
  font-family: monospace;
}

.num-input:focus {
  outline: none;
  border-color: var(--accent-color);
}

small {
  display: block;
  margin-top: 0.25rem;
  color: var(--text-secondary);
  font-size: 0.8rem;
}

.preview-info {
  background: rgba(14, 165, 233, 0.1);
  border: 1px solid rgba(14, 165, 233, 0.2);
  padding: 1rem;
  border-radius: 8px;
  margin-bottom: 1.5rem;
}

.preview-info h3 {
  color: #38bdf8;
  font-size: 0.95rem;
  margin-bottom: 0.5rem;
}

.preview-info ul {
  margin: 0;
  padding-left: 1.5rem;
  font-size: 0.85rem;
  color: var(--text-secondary);
  line-height: 1.5;
}

.footer {
  display: flex;
  justify-content: flex-end;
  gap: 1rem;
}

.btn-generate {
  min-width: 180px;
}
</style>
