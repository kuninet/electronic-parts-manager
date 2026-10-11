import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { hasPreviewablePhoto, buildLightboxMeta } from '../src/utils/photoPreview.js';

describe('photoPreview utility tests', () => {
  test('P-1: hasPreviewablePhoto returns true for valid image_path', () => {
    assert.equal(hasPreviewablePhoto({ image_path: '/uploads/a.jpg' }), true);
  });

  test('P-2: hasPreviewablePhoto returns false for null/undefined/empty/blank image_path or null part', () => {
    assert.equal(hasPreviewablePhoto({ image_path: null }), false);
    assert.equal(hasPreviewablePhoto({ image_path: undefined }), false);
    assert.equal(hasPreviewablePhoto({ image_path: '' }), false);
    assert.equal(hasPreviewablePhoto({ image_path: '   ' }), false);
    assert.equal(hasPreviewablePhoto(null), false);
    assert.equal(hasPreviewablePhoto(undefined), false);
  });

  test('P-3: hasPreviewablePhoto returns false for non-string image_path', () => {
    assert.equal(hasPreviewablePhoto({ image_path: 12345 }), false);
    assert.equal(hasPreviewablePhoto({ image_path: true }), false);
    assert.equal(hasPreviewablePhoto({ image_path: {} }), false);
  });

  test('P-4: buildLightboxMeta returns complete meta with explicit qty', () => {
    const part = {
      id: 1,
      part_number: 'NE555P',
      name: '汎用タイマーIC',
      category_name: 'IC・半導体',
      location_name: '棚A-1',
      quantity: 5
    };
    const meta = buildLightboxMeta(part, 7);
    assert.deepEqual(meta, {
      partNumber: 'NE555P',
      name: '汎用タイマーIC',
      category: 'IC・半導体',
      location: '棚A-1',
      qtyLabel: '在庫 7 個'
    });
  });

  test('P-5: buildLightboxMeta handles missing optional fields with defaults', () => {
    const part = {
      id: 2,
      name: '抵抗器'
    };
    const meta = buildLightboxMeta(part, 0);
    assert.deepEqual(meta, {
      partNumber: '',
      name: '抵抗器',
      category: '未分類',
      location: '場所未設定',
      qtyLabel: '在庫 0 個'
    });
  });

  test('P-6: buildLightboxMeta falls back to part.quantity when qty is undefined', () => {
    const part = {
      id: 3,
      name: 'コンデンサ',
      quantity: 3
    };
    const meta = buildLightboxMeta(part, undefined);
    assert.equal(meta.qtyLabel, '在庫 3 個');
  });
});
