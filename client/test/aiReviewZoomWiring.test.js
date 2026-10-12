import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.resolve(__dirname, '../src');

const reviewModalVuePath = path.resolve(srcDir, 'components/AiSuggestionReviewModal.vue');
const hoverComposablePath = path.resolve(srcDir, 'composables/useHoverImagePreview.js');
const zoomDialogVuePath = path.resolve(srcDir, 'components/ImageZoomDialog.vue');

describe('AI Review Image Hover & Zoom Wiring Consistency Tests', () => {
  test('W-1: AiSuggestionReviewModal.vue の写真が <button type="button" で包まれ、aria-label を持つ', () => {
    assert.ok(fs.existsSync(reviewModalVuePath), 'AiSuggestionReviewModal.vue must exist');
    const content = fs.readFileSync(reviewModalVuePath, 'utf-8');

    // thumb-btn によるラップと aria-label
    assert.match(content, /<button[^>]*type="button"[^>]*class="thumb-btn"[^>]*:aria-label=/);
    assert.match(content, /<img[^>]*class="thumb-img"/);
  });

  test('W-2: useHoverImagePreview.js が matchMedia("(hover: hover) and (pointer: fine)") を使う', () => {
    assert.ok(fs.existsSync(hoverComposablePath), 'useHoverImagePreview.js must exist');
    const content = fs.readFileSync(hoverComposablePath, 'utf-8');

    assert.match(content, /matchMedia\(['"]\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)['"]\)/);
  });

  test('W-3: AiSuggestionReviewModal.vue に <Teleport to="body"> があり、.hover-zoom の z-index が 1100 より大きく、pointer-events: none がある', () => {
    const content = fs.readFileSync(reviewModalVuePath, 'utf-8');

    assert.match(content, /<Teleport\s+to="body">/);
    assert.match(content, /class="hover-zoom"/);

    const hoverZoomMatch = content.match(/\.hover-zoom\s*\{([^}]*)\}/);
    assert.ok(hoverZoomMatch, '.hover-zoom css rule found in AiSuggestionReviewModal.vue');
    assert.match(hoverZoomMatch[1], /pointer-events\s*:\s*none/);

    const zIndexMatch = hoverZoomMatch[1].match(/z-index\s*:\s*(\d+)/);
    assert.ok(zIndexMatch, 'z-index found in .hover-zoom');
    const zIndex = parseInt(zIndexMatch[1], 10);
    assert.ok(zIndex > 1100, `z-index (${zIndex}) must be greater than 1100`);
  });

  test('W-4: 採用・却下・一括採用の各処理の中で hide() を呼んでいる', () => {
    const content = fs.readFileSync(reviewModalVuePath, 'utf-8');

    // handleApply
    const handleApplyMatch = content.match(/const\s+handleApply\s*=\s*async\s*\([^)]*\)\s*=>\s*\{([\s\S]*?)(?:const\s+handleReject|$)/);
    assert.ok(handleApplyMatch, 'handleApply found');
    assert.match(handleApplyMatch[1], /hoverZoom\.hide\(\)/);

    // handleReject
    const handleRejectMatch = content.match(/const\s+handleReject\s*=\s*async\s*\([^)]*\)\s*=>\s*\{([\s\S]*?)(?:const\s+handleResuggest|$)/);
    assert.ok(handleRejectMatch, 'handleReject found');
    assert.match(handleRejectMatch[1], /hoverZoom\.hide\(\)/);

    // handleApplyHighConfidence
    const handleBatchMatch = content.match(/const\s+handleApplyHighConfidence\s*=\s*async\s*\([^)]*\)\s*=>\s*\{([\s\S]*?)(?:const\s+getConfidenceBadgeClass|$)/);
    assert.ok(handleBatchMatch, 'handleApplyHighConfidence found');
    assert.match(handleBatchMatch[1], /hoverZoom\.hide\(\)/);
  });

  test('W-5: .modal-body に @scroll と @wheel がある', () => {
    const content = fs.readFileSync(reviewModalVuePath, 'utf-8');

    assert.match(content, /class="modal-body"[^>]*@scroll=/);
    assert.match(content, /@wheel(?:\.passive)?=/);
  });

  test('W-6: ImageZoomDialog.vue が focusTrap を import し、role="dialog" と aria-modal="true" を持ち、z-index が 1100 より大きい', () => {
    assert.ok(fs.existsSync(zoomDialogVuePath), 'ImageZoomDialog.vue must exist');
    const content = fs.readFileSync(zoomDialogVuePath, 'utf-8');

    assert.match(content, /import\s+[^;]*from\s+['"][^'"]*focusTrap(?:\.js)?['"]/);
    assert.match(content, /role="dialog"/);
    assert.match(content, /aria-modal="true"/);

    const overlayMatch = content.match(/\.zoom-overlay\s*\{([^}]*)\}/);
    assert.ok(overlayMatch, '.zoom-overlay css rule found in ImageZoomDialog.vue');
    const zIndexMatch = overlayMatch[1].match(/z-index\s*:\s*(\d+)/);
    assert.ok(zIndexMatch, 'z-index found in .zoom-overlay');
    const zIndex = parseInt(zIndexMatch[1], 10);
    assert.ok(zIndex > 1100, `z-index (${zIndex}) must be greater than 1100`);
  });

  test('W-7: ImageZoomDialog.vue が keydown を onUnmounted で解除し、overflow を元に戻す', () => {
    const content = fs.readFileSync(zoomDialogVuePath, 'utf-8');

    assert.match(content, /removeEventListener\(['"]keydown['"]/);
    assert.match(content, /document\.documentElement\.style\.overflow\s*=/);
    assert.match(content, /onUnmounted/);
  });
});
