import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.resolve(__dirname, '../src');

const partsListVuePath = path.resolve(srcDir, 'components/PartsList.vue');
const partCardVuePath = path.resolve(srcDir, 'components/parts/PartCard.vue');
const partRowVuePath = path.resolve(srcDir, 'components/parts/PartRow.vue');
const useDragSelectPath = path.resolve(srcDir, 'composables/useDragSelect.js');

describe('Batch Select Wiring Consistency Tests (W-1 ~ W-8)', () => {
  test('W-1: PartRow.vue と PartCard.vue のチェックボックスが @click で toggle-select を送り shiftKey を含める。@change="$emit(\'toggle-select\')" が残っていない', () => {
    const rowContent = fs.readFileSync(partRowVuePath, 'utf-8');
    const cardContent = fs.readFileSync(partCardVuePath, 'utf-8');

    // PartRow.vue
    assert.match(rowContent, /@click="\$emit\('toggle-select',\s*\{\s*shiftKey:\s*\$event\.shiftKey,\s*event:\s*\$event\s*\}\)"/);
    assert.doesNotMatch(rowContent, /@change="\$emit\('toggle-select'\)"/);

    // PartCard.vue
    assert.match(cardContent, /@click="\$emit\('toggle-select',\s*\{\s*shiftKey:\s*\$event\.shiftKey,\s*event:\s*\$event\s*\}\)"/);
    assert.doesNotMatch(cardContent, /@change="\$emit\('toggle-select'\)"/);
  });

  test('W-2: PartsList.vue が applyRangeSelection を onToggleSelect で使う', () => {
    const content = fs.readFileSync(partsListVuePath, 'utf-8');
    assert.match(content, /import\s*\{[^}]*applyRangeSelection[^}]*\}\s*from/);
    assert.match(content, /const onToggleSelect\s*=\s*\([^)]*\)\s*=>\s*\{[\s\S]*?applyRangeSelection\(\{/);
  });

  test('W-3: PartsList.vue に selectedParts.value = [] が clearSelection の中の 1 か所だけ残り、clearSelection が selectionAnchorId を null にする', () => {
    const content = fs.readFileSync(partsListVuePath, 'utf-8');
    const matches = content.match(/selectedParts\.value\s*=\s*\[\]/g) || [];
    assert.equal(matches.length, 1, `selectedParts.value = [] must appear exactly once in PartsList.vue, but found ${matches.length}`);

    const clearSelectionMatch = content.match(/const clearSelection\s*=\s*\(\)\s*=>\s*\{([\s\S]*?)\};/);
    assert.ok(clearSelectionMatch, 'clearSelection definition must exist');
    assert.match(clearSelectionMatch[1], /selectedParts\.value\s*=\s*\[\]/);
    assert.match(clearSelectionMatch[1], /selectionAnchorId\.value\s*=\s*null/);
  });

  test('W-4: useDragSelect.js が pointerType === \'mouse\' と button === 0 を確認する', () => {
    assert.ok(fs.existsSync(useDragSelectPath), 'useDragSelect.js must exist');
    const content = fs.readFileSync(useDragSelectPath, 'utf-8');
    assert.match(content, /pointerType\s*===\s*['"]mouse['"]/);
    assert.match(content, /button\s*===\s*0/);
  });

  test('W-5: useDragSelect.js が elementFromPoint と closest(\'[data-part-id]\') を使う', () => {
    const content = fs.readFileSync(useDragSelectPath, 'utf-8');
    assert.match(content, /document\.elementFromPoint/);
    assert.match(content, /\.closest\(['"]\[data-part-id\]['"]\)/);
  });

  test('W-6: useDragSelect.js に suppressNextClick（または同等の名前）があり、PartsList.vue の onToggleSelect の先頭で確認する', () => {
    const dragContent = fs.readFileSync(useDragSelectPath, 'utf-8');
    const partsListContent = fs.readFileSync(partsListVuePath, 'utf-8');

    assert.match(dragContent, /suppressNextClick/);
    assert.match(dragContent, /consumeSuppressedClick/);
    assert.match(partsListContent, /dragSelect\.consumeSuppressedClick\(\)/);
  });

  test('W-7: useDragSelect.js が登録した window のイベントを、終了時と onUnmounted で解除する', () => {
    const content = fs.readFileSync(useDragSelectPath, 'utf-8');
    assert.match(content, /window\.removeEventListener\(['"]pointermove['"]/);
    assert.match(content, /window\.removeEventListener\(['"]pointerup['"]/);
    assert.match(content, /window\.removeEventListener\(['"]pointercancel['"]/);
    assert.match(content, /window\.removeEventListener\(['"]blur['"]/);
    assert.match(content, /window\.removeEventListener\(['"]keydown['"]/);
    assert.match(content, /onUnmounted/);
  });

  test('W-8: .col-check（PartRow.vue）と .select-label（PartCard.vue）に user-select: none がある', () => {
    const rowContent = fs.readFileSync(partRowVuePath, 'utf-8');
    const cardContent = fs.readFileSync(partCardVuePath, 'utf-8');

    const colCheckMatch = rowContent.match(/\.col-check\s*\{([^}]*)\}/);
    assert.ok(colCheckMatch, '.col-check rule found in PartRow.vue');
    assert.match(colCheckMatch[1], /user-select\s*:\s*none/);

    const selectLabelMatch = cardContent.match(/\.select-label\s*\{([^}]*)\}/);
    assert.ok(selectLabelMatch, '.select-label rule found in PartCard.vue');
    assert.match(selectLabelMatch[1], /user-select\s*:\s*none/);
  });
});
