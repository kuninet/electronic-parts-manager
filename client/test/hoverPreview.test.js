import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeHoverPreviewPosition } from '../src/utils/hoverPreview.js';

describe('hoverPreview utility tests', () => {
  test('H-1: 画面 1920x1080、写真が x=600〜730（左に十分な空きがある場合は左優先）', () => {
    const result = computeHoverPreviewPosition({
      rect: { left: 600, right: 730, width: 130, height: 130, top: 200, bottom: 330 },
      viewport: { width: 1920, height: 1080 },
      size: { width: 480, height: 480 }
    });

    assert.equal(result.side, 'left');
    assert.equal(result.left, 108); // 600 - 12 (gap) - 480 (width) = 108
    assert.equal(result.width, 480);
    assert.equal(result.height, 480);
  });

  test('H-2: 画面 1280x800、写真が x=180〜310（左に入らない場合は写真の右に出す）', () => {
    const result = computeHoverPreviewPosition({
      rect: { left: 180, right: 310, width: 130, height: 130, top: 200, bottom: 330 },
      viewport: { width: 1280, height: 800 },
      size: { width: 480, height: 480 }
    });

    assert.equal(result.side, 'right');
    assert.equal(result.left, 322); // 310 + 12 = 322
    assert.equal(result.width, 480);
    assert.equal(result.height, 480);
  });

  test('H-3: 画面 1024x768、写真が x=500〜630（左にも右にも通常では入らない場合は右端寄せ）', () => {
    const result = computeHoverPreviewPosition({
      rect: { left: 500, right: 630, width: 130, height: 130, top: 200, bottom: 330 },
      viewport: { width: 1024, height: 768 },
      size: { width: 480, height: 480 }
    });

    assert.equal(result.side, 'right');
    assert.ok(result.left + result.width <= 1024 - 16, '右端マージン内に収まる');
    assert.ok(result.left >= 16, '左端マージン以上である');
    assert.equal(result.left, 1024 - 16 - 480); // 528
  });

  test('H-4: 写真が画面の下端近く（top = 700、画面の高さ 768 の場合は下端からはみ出さない）', () => {
    const result = computeHoverPreviewPosition({
      rect: { left: 600, right: 730, width: 130, height: 130, top: 700, bottom: 830 },
      viewport: { width: 1920, height: 768 },
      size: { width: 480, height: 480 }
    });

    assert.ok(result.top + result.height <= 768 - 16, '下端マージン内に収まる');
    assert.equal(result.top, 768 - 16 - 480); // 272
  });

  test('H-5: 写真が画面の上端近く（top = 0 の場合は上端マージン以上になる）', () => {
    const result = computeHoverPreviewPosition({
      rect: { left: 600, right: 730, width: 130, height: 130, top: 0, bottom: 130 },
      viewport: { width: 1920, height: 1080 },
      size: { width: 480, height: 480 }
    });

    assert.ok(result.top >= 16, '上端マージン以上である');
    assert.equal(result.top, 16);
  });

  test('H-6: 画面 390x844（狭い画面の場合は幅が画面に合わせて縮まりはみ出さない）', () => {
    const result = computeHoverPreviewPosition({
      rect: { left: 20, right: 150, width: 130, height: 130, top: 100, bottom: 230 },
      viewport: { width: 390, height: 844 },
      size: { width: 480, height: 480 }
    });

    assert.ok(result.width <= 390 - 32, '幅が viewport.width - margin * 2 以下');
    assert.ok(result.left >= 16, '左端マージン以上');
    assert.ok(result.left + result.width <= 390 - 16, '右端マージン以下');
  });

  test('H-7: 写真の縦位置が画面の中ほどにある場合、ポップアップの中心と写真の中心が一致する', () => {
    const rectTop = 400;
    const rectHeight = 130;
    const photoCenterY = rectTop + rectHeight / 2; // 465

    const result = computeHoverPreviewPosition({
      rect: { left: 600, right: 730, width: 130, height: rectHeight, top: rectTop, bottom: rectTop + rectHeight },
      viewport: { width: 1920, height: 1080 },
      size: { width: 480, height: 480 }
    });

    const popupCenterY = result.top + result.height / 2;
    assert.equal(popupCenterY, photoCenterY, '縦の中心が一致する');
  });
});
