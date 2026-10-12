import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.resolve(__dirname, '../src');

const appVuePath = path.resolve(srcDir, 'App.vue');
const partsListVuePath = path.resolve(srcDir, 'components/PartsList.vue');
const partCardVuePath = path.resolve(srcDir, 'components/parts/PartCard.vue');
const partRowVuePath = path.resolve(srcDir, 'components/parts/PartRow.vue');
const lightboxModalVuePath = path.resolve(srcDir, 'components/PhotoLightboxModal.vue');

describe('Lightbox Wiring Consistency Tests', () => {
  test('W-1: App.vue isBlocked includes previewPart check', () => {
    const content = fs.readFileSync(appVuePath, 'utf-8');
    const isBlockedMatch = content.match(/isBlocked\s*:\s*\(\)\s*=>\s*([\s\S]*?)(?:,\s*\n|\n\s*\}\);)/);
    assert.ok(isBlockedMatch, 'isBlocked definition found in App.vue');
    if (/isAnyDialogOpen/.test(isBlockedMatch[1])) {
      assert.match(content, /const isAnyDialogOpen = \(\) =>[\s\S]*?previewPart/);
    } else {
      assert.match(isBlockedMatch[1], /previewPart/);
    }
  });

  test('W-2: App.vue renders PhotoLightboxModal with required props/events and wires PartsList @preview', () => {
    const content = fs.readFileSync(appVuePath, 'utf-8');
    assert.match(content, /<PhotoLightboxModal[^>]*v-if="previewPart"[^>]*:part="previewPart"[^>]*@close="closePhotoPreview"[^>]*@edit="onPreviewEdit"/);
    assert.match(content, /<PartsList[^>]*@preview="(?:openPhotoPreview|previewPart = \$event)"/);
  });

  test('W-3: PartsList.vue emits preview from PartRow(stack), PartCard, and PartRow(table)', () => {
    const content = fs.readFileSync(partsListVuePath, 'utf-8');
    const matches = content.match(/@preview="\$emit\('preview',\s*part\)"/g) || [];
    assert.ok(matches.length >= 3, `Expected at least 3 occurrences of @preview="$emit('preview', part)", found ${matches.length}`);
  });

  test('W-4: PhotoLightboxModal.vue implements dialog a11y, focus trap, and restoreFocus prevention', () => {
    assert.ok(fs.existsSync(lightboxModalVuePath), 'PhotoLightboxModal.vue must exist');
    const content = fs.readFileSync(lightboxModalVuePath, 'utf-8');
    assert.match(content, /role="dialog"/);
    assert.match(content, /aria-modal="true"/);
    assert.match(content, /:aria-labelledby=/);
    assert.match(content, /Escape/);
    assert.match(content, /nextTrapIndex/);
    assert.match(content, /restoreFocus\s*=\s*false/);
  });

  test('W-5: PartCard.vue and PartRow.vue import hasPreviewablePhoto, emit preview, and PartRow uses click.stop', () => {
    const cardContent = fs.readFileSync(partCardVuePath, 'utf-8');
    const rowContent = fs.readFileSync(partRowVuePath, 'utf-8');

    assert.match(cardContent, /hasPreviewablePhoto/);
    assert.match(cardContent, /emit\('preview'\)/);

    assert.match(rowContent, /hasPreviewablePhoto/);
    assert.match(rowContent, /emit\('preview'\)/);
    assert.match(rowContent, /@click\.stop="onPhotoClick"/);
  });

  test('W-6: PartCard.vue sets pointer-events: none on .status-badge', () => {
    const cardContent = fs.readFileSync(partCardVuePath, 'utf-8');
    const badgeMatch = cardContent.match(/\.status-badge\s*\{([^}]*)\}/);
    assert.ok(badgeMatch, '.status-badge css rule found in PartCard.vue');
    assert.match(badgeMatch[1], /pointer-events\s*:\s*none/);
  });
});
